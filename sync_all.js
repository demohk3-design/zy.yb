const fs = require('fs');
const path = require('path');

const NAME_TO_CODE = {
    "玻璃": "FG", "纸浆": "SP", "尿素": "UR", "碳酸锂": "LC",
    "焦煤": "JM", "沥青": "BU", "石油沥青": "BU", "聚丙烯": "PP", "PVC": "V", "聚氯乙烯": "V",
    "纯碱": "SA", "烧碱": "SH", "燃料油": "FU", "氧化铝": "AO",
    "鸡蛋": "JD", "花生": "PK", "菜籽粕": "RM", "菜籽油": "OI", "菜籽油OI": "OI",
    "白糖": "SR", "甲醇": "MA", "甲醇MA": "MA",
    "苹果": "AP", "鲜苹果": "AP",
    "生猪": "LH", "红枣": "CJ", "红枣CJ": "CJ"
};

const CONTRACT_SPECS = {
    AP: { contractSize: 10, unit: "吨/手" },
    SP: { contractSize: 10, unit: "吨/手" },
    UR: { contractSize: 20, unit: "吨/手" },
    FG: { contractSize: 20, unit: "吨/手" },
    LC: { contractSize: 1, unit: "吨/手" },
    JM: { contractSize: 60, unit: "吨/手" },
    BU: { contractSize: 10, unit: "吨/手" },
    PP: { contractSize: 5, unit: "吨/手" },
    V: { contractSize: 5, unit: "吨/手" },
    SA: { contractSize: 20, unit: "吨/手" },
    SH: { contractSize: 30, unit: "吨/手" },
    FU: { contractSize: 10, unit: "吨/手" },
    AO: { contractSize: 20, unit: "吨/手" },
    JD: { contractSize: 5, unit: "吨/手" },
    PK: { contractSize: 5, unit: "吨/手" },
    RM: { contractSize: 10, unit: "吨/手" },
    OI: { contractSize: 10, unit: "吨/手" },
    SR: { contractSize: 10, unit: "吨/手" },
    MA: { contractSize: 10, unit: "吨/手" },
    LH: { contractSize: 16, unit: "吨/手" },
    CJ: { contractSize: 5, unit: "吨/手" }
};

const DEFAULT_COSTS = {
    AP: { productionCost: 7000, cashCost: 6000, priceBasis: "close", note: "苹果生产完全成本约7000元/吨，果农冷库出货现金折算价约6000元/吨" },
    SP: { productionCost: 5500, cashCost: 4800, priceBasis: "close", note: "针叶浆外盘进口折算完全成本约5500元/吨，部分低成本外商长协折算现金底线4800元/吨" },
    UR: { productionCost: 1600, cashCost: 1350, priceBasis: "close", note: "尿素新型煤气化完全成本线约1600元/吨，固定床与气头边际现金底线1350元/吨" },
    FG: { productionCost: 1250, cashCost: 1100, priceBasis: "close", note: "玻璃纯碱/石英完全成本降至约1250元/吨，沙河龙头玻璃厂现金流底线约1100元/吨" },
    LC: { productionCost: 75000, cashCost: 55000, priceBasis: "close", note: "碳酸锂外购辉石完全成本已沉淀至75000元/吨，盐湖及自有锂矿先进现金成本线55000元/吨" },
    JM: { productionCost: 1200, cashCost: 1000, priceBasis: "close", note: "焦煤国内主流原煤洗选完全成本约1200元/吨，山西主力煤企大井口现金成本底线1000元/吨" },
    BU: { productionCost: 3500, cashCost: 3100, priceBasis: "close", note: "沥青国内主港原油折算完全加工成本约3500元/吨，炼厂边际副产品现金折算成本3100元/吨" },
    PP: { productionCost: 7500, cashCost: 7000, priceBasis: "close", note: "聚丙烯拉丝完全成本7500元/吨，油头与PDH先进装置边际现金底线7000元/吨" },
    V: { productionCost: 5500, cashCost: 4900, priceBasis: "close", note: "PVC外购电石法完全生产成本约5500元/吨，西北一体化大厂边际现金成本底线4900元/吨" },
    SA: { productionCost: 1200, cashCost: 900, priceBasis: "close", note: "纯碱天然碱完全成本600-800，先进联碱完全成本1200，此处使用联碱完全成本与天然碱现金底防守" },
    SH: { productionCost: 2400, cashCost: 2000, priceBasis: "close", note: "烧碱折百完全生产成本约2400元/吨，氯碱平衡下的先进边际现金底线2000元/吨" },
    FU: { productionCost: 3200, cashCost: 2800, priceBasis: "close", note: "高硫燃料油进口到岸完税成本约3200元/吨，中东/新加坡裂解现金流成本2800元/吨" },
    AO: { productionCost: 3200, cashCost: 2800, priceBasis: "close", note: "氧化铝国内完全成本在3200元/吨左右，国产矿石提炼的先进企业现金流底线2800元/吨" },
    JD: { productionCost: 3400, cashCost: 3100, priceBasis: "close", note: "鸡蛋饲料配比完全成本3400元/吨，老鸡淘汰折算现金存栏成本3100元/吨" },
    PK: { productionCost: 8200, cashCost: 7800, priceBasis: "close", note: "花生农户种植完全成本8200元/吨，主产区收购/中间环节周转现金底线7800元/吨" },
    RM: { productionCost: 2200, cashCost: 1950, priceBasis: "close", note: "菜粕进口菜籽压榨完全折算成本约2200元/吨，油厂压榨加工现金运转底线1950元/吨" },
    OI: { productionCost: 8200, cashCost: 7800, priceBasis: "close", note: "菜油进口压榨完全折算成本8200元/吨，港口精炼出库现金成本7800元/吨" },
    SR: { productionCost: 6000, cashCost: 5500, priceBasis: "close", note: "白糖广西糖料蔗完全成本6000元/吨，甜菜糖/进口糖现金底线5500元/吨" },
    MA: { productionCost: 2200, cashCost: 1900, priceBasis: "close", note: "甲醇内地煤制完全成本降至2200元/吨左右，西北大装置边际现金底线1900元/吨" },
    LH: { productionCost: 15000, cashCost: 13000, priceBasis: "close", note: "生猪规模化养殖平均完全成本约15000元/吨（15元/kg），现金流底线约13000元/吨（13元/kg）" },
    CJ: { productionCost: 9200, cashCost: 8300, priceBasis: "close", note: "红枣仓单注册完全成本约9000-9500元/吨，主产区灰枣初加工折算现金流底线8000-8500元/吨" }
};

const SUPPLY_DEMAND_DATA = {
    AP: { capacity: "约4500万吨", production: "约4500万吨", consumption: "约4300万吨", balance: "供需整体平衡，阶段性供给压力大" },
    SP: { capacity: "主要是进口", production: "极低(主要进口针叶浆)", consumption: "约4400万吨", balance: "高度依赖进口，供求平稳" },
    UR: { capacity: "约8500万吨", production: "约6200万吨", consumption: "约5800万吨", balance: "供大于求，整体产能过剩" },
    FG: { capacity: "约6000万吨", production: "约5000万吨", consumption: "约4800万吨", balance: "产能过剩，下游地产需求承压" },
    LC: { capacity: "全球140万吨LCE", production: "国内约60万吨", consumption: "约75万吨", balance: "全球供给过剩，去库周期中" },
    JM: { capacity: "洗选产能过剩", production: "约4.9亿吨", consumption: "约5.5亿吨", balance: "结构性短缺，高度依赖蒙俄进口" },
    BU: { capacity: "约6500万吨", production: "约3200万吨", consumption: "约3100万吨", balance: "产能严重过剩，需求较为低迷" },
    PP: { capacity: "约4500万吨", production: "约3400万吨", consumption: "约3500万吨", balance: "处于产能扩张期，供求宽松" },
    V: { capacity: "约2800万吨", production: "约2200万吨", consumption: "约2000万吨", balance: "供大于求，依赖出口消化库存" },
    SA: { capacity: "约3800万吨", production: "约3200万吨", consumption: "约2900万吨", balance: "新增产能集中释放，供大于求" },
    SH: { capacity: "约5600万吨", production: "约4650万吨", consumption: "约4400万吨", balance: "过剩格局，氧化铝实际消耗不及预期" },
    FU: { capacity: "精炼副产品", production: "国内约1500万吨", consumption: "约2000万吨", balance: "国内高硫资源偏紧，主要靠进口" },
    AO: { capacity: "约1.05亿吨", production: "约8200万吨", consumption: "约8300万吨", balance: "受矿石紧缺制约，开工率受限" },
    JD: { capacity: "在产蛋鸡12亿只", production: "约2200万吨", consumption: "约2150万吨", balance: "供求基本平衡，有季节性波动" },
    PK: { capacity: "种植完全成本支撑", production: "约1800万吨", consumption: "约1750万吨", balance: "供需平稳，进口米有一定冲击" },
    RM: { capacity: "压榨产能过剩", production: "国内约650万吨", consumption: "约680万吨", balance: "多为进口菜籽压榨，看进口节奏" },
    OI: { capacity: "精炼产能过剩", production: "国内约300万吨", consumption: "约380万吨", balance: "大豆菜籽压榨量大，油脂供求宽松" },
    SR: { capacity: "糖厂压榨能力强", production: "1280万吨(25/26榨季)", consumption: "1573万吨", balance: "供需偏紧，严重依赖配额内外进口" },
    MA: { capacity: "约1.2亿吨", production: "约8600万吨", consumption: "约9000万吨", balance: "高产能低开工，港口高度看进口量" },
    LH: { capacity: "能繁母猪4000万头", production: "猪肉约5400万吨", consumption: "约5500万吨", balance: "生猪去产能周期尾声，供求趋紧" },
    CJ: { capacity: "约35万吨", production: "约26万吨", consumption: "约28万吨", balance: "结转旧作库存高企，新季存在减产与天气炒作预期" }
};

const FALLBACK_SPOT_PRICES = {
    AO: 2800,  // 氧化铝SMM现货日均价
    AP: 7450,  // 苹果现货地头参考价
    PK: 8400,  // 花生现货出货均价
    CJ: 8600   // 红枣一级灰枣现货均价
};

const BASIS_QUALITY = {
    FG: { comparable: false, reason: "现货常见口径为元/平方米或元/重量箱，需折算后才能与期货元/吨比较" },
    SH: { comparable: false, reason: "现货常见口径为液碱不同浓度报价，需折百/合约规格换算" },
    JD: { comparable: false, reason: "现货常见口径为元/斤，需换算至期货合约报价口径" },
    FU: { comparable: false, reason: "现货口径与燃料油期货交割规格可能不一致，需确认硫含量/地区/单位" },
    LH: { comparable: false, reason: "生猪现货报价多为元/公斤，需乘1000折算为元/吨方可与期货比较" }
};

const SYMBOLS = [
    "AP2610", "SP2609", "UR2609", "FG2609", "LC2609",
    "JM2609", "BU2609", "PP2609", "V2609", "SA2609",
    "SH2609", "FU2609", "AO2609", "JD2609", "PK2610",
    "RM2609", "OI2609", "SR2609", "MA2609", "LH2609",
    "CJ2609"
];

const CODES = Object.values(NAME_TO_CODE).filter((v, i, a) => a.indexOf(v) === i);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HISTORY_DIR = path.join(__dirname, 'history');
const HISTORY_PATH = path.join(HISTORY_DIR, 'market_snapshots.json');
const COST_CONFIG_PATH = path.join(__dirname, 'cost_config.json');

const QHKCH_CODE_MAP = {
    AP: "AP", SP: "SP", UR: "UR", FG: "FG", LC: "LC",
    JM: "JM", BU: "BU", PP: "PP", V: "V", SA: "SA",
    SH: "SH", FU: "FU", AO: "AO", JD: "JD", PK: "PK",
    RM: "RM", OI: "OI", SR: "SR", MA: "MA", LH: "LH",
    CJ: "CJ"
};

async function fetchWithRetry(url, options = {}, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetch(url, options);
        } catch (e) {
            lastError = e;
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            }
        }
    }
    throw lastError;
}

async function safeCall(label, fn, fallback) {
    try {
        return await fn();
    } catch (e) {
        console.warn(`【警告】${label} 获取失败: ${e.message}`);
        return fallback;
    }
}

function toNumber(value) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
}

function toInteger(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function parseTradeDate(value) {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function loadCostConfig() {
    if (!fs.existsSync(COST_CONFIG_PATH)) return {};
    try {
        const data = JSON.parse(fs.readFileSync(COST_CONFIG_PATH, 'utf8'));
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        console.warn(`【警告】成本配置读取失败: ${e.message}`);
        return {};
    }
}

function loadHistory() {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn(`【警告】历史快照读取失败: ${e.message}`);
        return [];
    }
}

function saveHistory(history, mergedData) {
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const snapshot = {
        update_time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        tradeDate: Object.values(mergedData).find(row => row.tradeDate)?.tradeDate || null,
        data: {}
    };

    for (const [code, row] of Object.entries(mergedData)) {
        snapshot.data[code] = {
            contract: row.contract || null,
            close: row.close ?? null,
            high: row.high ?? null,
            low: row.low ?? null,
            previousSettlement: row.previousSettlement ?? null,
            volume: row.volume ?? null,
            openInterest: row.openInterest ?? null,
            warrant: row.warrant ?? null,
            warrantChange: row.warrantChange ?? null
        };
    }

    const key = snapshot.tradeDate || snapshot.update_time;
    const filtered = history.filter(item => (item.tradeDate || item.update_time) !== key);
    filtered.push(snapshot);
    filtered.sort((a, b) => String(a.tradeDate || a.update_time).localeCompare(String(b.tradeDate || b.update_time)));
    const trimmed = filtered.slice(-60);
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 4), 'utf8');
    return trimmed;
}

function getRecentRows(history, code, limit = 5) {
    return history
        .filter(item => item.data && item.data[code])
        .slice(-limit)
        .map(item => ({ date: item.tradeDate || item.update_time, ...item.data[code] }));
}

async function getSinaDailyKLine(symbol) {
    if (!/^[A-Z]+\d+$/.test(symbol)) return [];
    const url = `https://stock2.finance.sina.com.cn/futures/api/json.php/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(symbol)}`;
    const response = await fetchWithRetry(url, { headers: { 'User-Agent': UA, 'Referer': 'https://finance.sina.com.cn/' } }, 1);
    const text = await response.text();
    if (!text || text === 'null') return [];
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) return [];
    return rows.slice(-10).map(row => ({
        date: row.d || row[0],
        open: toNumber(row.o ?? row[1]),
        high: toNumber(row.h ?? row[2]),
        low: toNumber(row.l ?? row[3]),
        close: toNumber(row.c ?? row[4]),
        volume: toInteger(row.v ?? row[5]),
        openInterest: toInteger(row.p ?? row[6]),
        previousSettlement: toNumber(row.s ?? null),
        source: "sina_contract_daily"
    })).filter(row => row.date && Number.isFinite(row.close));
}

async function backfillRecentDailyHistory(mergedData, history) {
    const byDate = new Map();
    for (const snapshot of history) {
        const key = snapshot.tradeDate || snapshot.update_time;
        byDate.set(key, {
            update_time: snapshot.update_time,
            tradeDate: snapshot.tradeDate || null,
            data: { ...(snapshot.data || {}) }
        });
    }

    const tasks = Object.entries(mergedData).map(async ([code, row]) => {
        if (!row.contract) return;
        try {
            const dailyRows = await getSinaDailyKLine(row.contract);
            for (const daily of dailyRows.slice(-5)) {
                if (!daily.date) continue;
                if (!byDate.has(daily.date)) {
                    byDate.set(daily.date, {
                        update_time: daily.date,
                        tradeDate: daily.date,
                        data: {}
                    });
                }
                const snapshot = byDate.get(daily.date);
                snapshot.data[code] = {
                    ...(snapshot.data[code] || {}),
                    contract: row.contract,
                    close: daily.close,
                    high: daily.high,
                    low: daily.low,
                    previousSettlement: daily.previousSettlement,
                    volume: daily.volume,
                    openInterest: daily.openInterest,
                    warrant: snapshot.data[code]?.warrant ?? null,
                    warrantChange: snapshot.data[code]?.warrantChange ?? null,
                    historySource: daily.source
                };
            }
        } catch (e) {
            console.warn(`【警告】${code} 最近日线回填失败: ${e.message}`);
        }
    });

    await Promise.all(tasks);
    let result = [...byDate.values()]
        .sort((a, b) => String(a.tradeDate || a.update_time).localeCompare(String(b.tradeDate || b.update_time)));
    const latestTs = Math.max(...result.map(item => parseTradeDate(item.tradeDate)).filter(Number.isFinite));
    if (Number.isFinite(latestTs)) {
        const cutoffTs = latestTs - 45 * 24 * 60 * 60 * 1000;
        result = result.filter(item => {
            const ts = parseTradeDate(item.tradeDate);
            return !Number.isFinite(ts) || ts >= cutoffTs;
        });
    }
    result = result.slice(-60);
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(result, null, 4), 'utf8');
    return result;
}

// 1. 获取新浪价格数据
async function getSinaPrices() {
    const listParam = SYMBOLS.map(s => `nf_${s.toUpperCase()}`).join(',');
    const url = `https://hq.sinajs.cn/list=${listParam}`;
    const response = await fetchWithRetry(url, {
        headers: { 'Referer': 'https://finance.sina.com.cn/', 'User-Agent': UA }
    });
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('gbk');
    const rawText = decoder.decode(buffer);
    
    const lines = rawText.split('\n');
    const prices = {};
    
    for (const line of lines) {
        if (!line.trim()) continue;
        const match = line.match(/hq_str_nf_([a-zA-Z0-9]+)="([^"]+)"/);
        if (!match) continue;
        
        const symbol = match[1].toUpperCase();
        const parts = match[2].split(',');
        if (parts.length < 15) continue;
        
        const commodity = symbol.match(/^([A-Z]+)\d+$/)[1];
        const open = toNumber(parts[2]);
        const high = toNumber(parts[3]);
        const low = toNumber(parts[4]);
        const lastPrice = toNumber(parts[8]);
        const closeField = toNumber(parts[5]);
        const close = closeField && closeField > 0 ? closeField : lastPrice;
        const previousSettlement = toNumber(parts[10]);
        const volume = toInteger(parts[13]);
        const openInterest = toInteger(parts[14]);
        const avgPrice = toNumber(parts[27]) || toNumber(parts[28]);
        const priceChange = close !== null && previousSettlement !== null ? close - previousSettlement : null;
        const priceChangePct = priceChange !== null && previousSettlement ? priceChange / previousSettlement : null;

        prices[commodity] = {
            contract: symbol,
            name: parts[0],
            exchange: parts[15] || null,
            tradeDate: parts[17] || null,
            time: parts[1] || null,
            open,
            high,
            low,
            lastPrice,
            close,
            previousSettlement,
            avgPrice,
            volume,
            openInterest,
            priceChange,
            priceChangePct: round(priceChangePct, 6),
            rangePct: high !== null && low !== null && previousSettlement ? round((high - low) / previousSettlement, 6) : null
        };
    }
    return prices;
}

// 2. 获取生意社基差数据
async function getSunsirsBasis() {
    let response = await fetchWithRetry('http://www.100ppi.com/sf/', { headers: { 'User-Agent': UA } });
    let text = await response.text();
    const match = text.match(/_0x2\s*=\s*"([a-f0-9]+)"/);
    if (!match) return {};
    
    const cookie = `HW_CHECK=${match[1]}`;
    let response2 = await fetchWithRetry('http://www.100ppi.com/sf/', {
        headers: { 'Cookie': cookie, 'User-Agent': UA, 'Referer': 'http://www.100ppi.com/sf/' }
    });
    let html = await response2.text();
    
    let cleanHtml = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (m) => {
        const fontMatches = [...m.matchAll(/<font[^>]*>([\s\S]*?)<\/font>/gi)].map(f => f[1].trim());
        return `[BASIS_DATA:${fontMatches[0] || ''}:${fontMatches[1] || ''}]`;
    });
    
    const rows = cleanHtml.split(/<tr/i);
    const basis = {};
    for (const row of rows) {
        if (!row.includes('</td>')) continue;
        const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
            return m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
        });
        if (tds.length < 8) continue;
        
        const cnName = tds[0];
        const code = NAME_TO_CODE[cnName];
        if (!code) continue;
        
        const basisMatch = tds[7].match(/\[BASIS_DATA:([^:]*):([^\]]*)\]/);
        const quality = BASIS_QUALITY[code] || { comparable: true, reason: null };
        basis[code] = {
            spotPrice: parseFloat(tds[1]),
            basis: basisMatch ? parseFloat(basisMatch[1]) : null,
            basisRate: basisMatch ? basisMatch[2] : null,
            basisComparable: quality.comparable,
            basisQualityNote: quality.reason
        };
    }
    return basis;
}

// 3. 获取东方财富仓单数据
async function getEastmoneyWarrants() {
    const promises = CODES.map(async (code) => {
        try {
            const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_FUTU_STOCKDATA&columns=SECURITY_CODE,TRADE_DATE,ON_WARRANT_NUM,ADDCHANGE&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=20&sortTypes=-1&sortColumns=TRADE_DATE&source=WEB&client=WEB`;
            const r = await fetchWithRetry(url, { headers: { 'User-Agent': UA } }, 1);
            const data = await r.json();
            if (data.success && data.result && data.result.data && data.result.data.length > 0) {
                const history = data.result.data.map(item => ({
                    date: item.TRADE_DATE ? item.TRADE_DATE.split(' ')[0] : null,
                    warrant: toNumber(item.ON_WARRANT_NUM),
                    change: toNumber(item.ADDCHANGE)
                }));
                const item = history[0];
                const fiveDayChange = history.slice(0, 5).reduce((sum, row) => sum + (row.change || 0), 0);
                const contractSize = CONTRACT_SPECS[code]?.contractSize || null;
                return {
                    code,
                    warrant: item.warrant,
                    warrantChange: item.change,
                    warrant5dChange: fiveDayChange,
                    warrantDate: item.date,
                    warrantLots: contractSize && item.warrant !== null ? round(item.warrant / contractSize, 2) : null,
                    warrantHistory: history
                };
            }
        } catch (e) {
            // 忽略错误
        }
        return { code, warrant: null, warrantChange: null, warrant5dChange: null, warrantDate: null, warrantLots: null, warrantHistory: [] };
    });
    
    const results = await Promise.all(promises);
    const warrants = {};
    for (const res of results) {
        warrants[res.code] = {
            warrant: res.warrant,
            warrantChange: res.warrantChange,
            warrant5dChange: res.warrant5dChange,
            warrantDate: res.warrantDate,
            warrantLots: res.warrantLots,
            warrantHistory: res.warrantHistory
        };
    }
    return warrants;
}

function pickProfitItem(payload) {
    if (!payload) return null;
    if (Array.isArray(payload)) return payload[0] || null;
    if (Array.isArray(payload.data)) return payload.data[0] || null;
    if (Array.isArray(payload.result)) return payload.result[0] || null;
    if (payload.data && typeof payload.data === 'object') return payload.data;
    if (payload.result && typeof payload.result === 'object') return payload.result;
    return typeof payload === 'object' ? payload : null;
}

function normalizeProfitPayload(code, payload) {
    const item = pickProfitItem(payload);
    if (!item) return null;
    const profit = toNumber(item.profit ?? item.profit_value ?? item.value ?? item.PROFIT ?? item.利润);
    const cost = toNumber(item.cost ?? item.cost_price ?? item.production_cost ?? item.COST ?? item.成本);
    const profitRate = toNumber(item.profit_rate ?? item.rate ?? item.PROFIT_RATE ?? item.利润率);
    const date = item.date ?? item.trade_date ?? item.TRADE_DATE ?? item.日期 ?? null;
    if (profit === null && cost === null && profitRate === null) return null;
    return {
        code,
        productionCost: cost,
        cashCost: DEFAULT_COSTS[code]?.cashCost || null,
        industrialProfit: profit,
        industrialProfitRate: profitRate !== null && Math.abs(profitRate) > 1 ? profitRate / 100 : profitRate,
        profitDate: date,
        profitSource: "qhkch_profit",
        profitNote: "奇货可查利润数据"
    };
}

async function fetchQhkchProfit(code, tradeDate) {
    const token = process.env.QHKCH_TOKEN || process.env.QHKCH_API_TOKEN;
    if (!token || !tradeDate) return null;
    const apiCode = QHKCH_CODE_MAP[code] || code;
    const urls = [
        `https://api.qhkch.com/profit/${apiCode}/${tradeDate}`,
        `https://api.qhkch.com/profit2/${apiCode}/${tradeDate}`,
        `https://api.qhkch.com/future_profit/${apiCode}/${tradeDate}`,
        `https://api.qhkch.com/variety_profit/${apiCode}/${tradeDate}`
    ];
    for (const url of urls) {
        try {
            const r = await fetchWithRetry(url, { headers: { 'User-Agent': UA, 'X-Token': token } }, 0);
            const text = await r.text();
            if (!text || text.trim().startsWith('<')) continue;
            const data = JSON.parse(text);
            const normalized = normalizeProfitPayload(code, data);
            if (normalized) return normalized;
        } catch (e) {
            // 忽略错误
        }
    }
    return null;
}

function buildLocalCostProfit(code, row, config) {
    const item = config[code] || DEFAULT_COSTS[code];
    if (!item || typeof item !== 'object') {
        return {
            productionCost: null,
            cashCost: null,
            industrialProfit: null,
            industrialProfitRate: null,
            profitDate: null,
            profitSource: null,
            profitNote: "缺少成本利润数据源；可配置 QHKCH_TOKEN 或在 cost_config.json 填入该品种成本口径"
        };
    }

    const productionCost = toNumber(item.productionCost ?? item.cost);
    const cashCost = toNumber(item.cashCost ?? item.cash_cost);
    const cost = cashCost ?? productionCost; // 按现金成本优先计算利润
    const priceBasis = item.priceBasis || "close";
    const price = priceBasis === "spot" ? toNumber(row.spotPrice) : toNumber(row.close);
    const profit = cost !== null && price !== null ? price - cost : null;
    const profitRate = cost !== null && cost !== 0 && profit !== null ? profit / cost : null;
    return {
        productionCost: productionCost,
        cashCost: cashCost,
        industrialProfit: profit,
        industrialProfitRate: profitRate,
        profitDate: item.date || row.tradeDate || null,
        profitSource: config[code] ? "local_cost_config" : "default_hardcoded_costs",
        profitNote: item.note || `默认/本地成本口径，价格使用${priceBasis === "spot" ? "现货价" : "期货收盘价"}`
    };
}

async function getIndustryProfits(mergedData) {
    const config = loadCostConfig();
    const entries = Object.entries(mergedData);
    const results = await Promise.all(entries.map(async ([code, row]) => {
        const remote = await fetchQhkchProfit(code, row.tradeDate);
        return [code, remote || buildLocalCostProfit(code, row, config)];
    }));
    return Object.fromEntries(results);
}

function buildQualityWarnings(code, row) {
    const warnings = [];
    if (!row.contract) warnings.push("缺少行情合约数据");
    if (row.close === null || row.close === undefined) warnings.push("缺少最新价/收盘价");
    if (row.openInterest === null || row.openInterest === undefined) warnings.push("缺少持仓量，无法判断增减仓");
    if (row.basisComparable === false) warnings.push(`基差口径需校验：${row.basisQualityNote}`);
    if (row.warrantDate && row.tradeDate && row.warrantDate < row.tradeDate) warnings.push(`仓单日期(${row.warrantDate})早于行情日期(${row.tradeDate})`);
    if (row.warrant !== null && row.openInterest && row.warrantLots !== null) {
        const ratio = row.warrantLots / row.openInterest;
        row.warrantToOpenInterest = round(ratio, 6);
        if (ratio > 0.2) warnings.push("仓单折手占持仓比例偏高，注意交割/套保压力");
    }
    return warnings;
}

function scoreLongCandidate(code, row, recentRows = []) {
    let score = 45; // 默认: 中位震荡
    let action = "中位震荡";
    const reasons = [];
    const risks = [];
    const signals = {};

    const close = Number.isFinite(row.close) ? row.close : null;
    const productionCost = Number.isFinite(row.productionCost) ? row.productionCost : (DEFAULT_COSTS[code]?.productionCost || null);
    const cashCost = Number.isFinite(row.cashCost) ? row.cashCost : (DEFAULT_COSTS[code]?.cashCost || null);

    signals.productionCost = productionCost;
    signals.cashCost = cashCost;
    signals.close = close;

    if (close !== null && (productionCost !== null || cashCost !== null)) {
        if (cashCost !== null && close <= cashCost) {
            score = 90;
            action = "绝对抄底区";
            reasons.push(`最新价(${close})低于或贴近现金成本底线(${cashCost})，具备极高安全垫，行业面临大面积亏损减产`);
        } else if (productionCost !== null && close <= productionCost) {
            score = 75;
            action = "生产成本线";
            reasons.push(`最新价(${close})低于或逼近生产成本线(${productionCost})，行业整体亏损，供给收缩拐点将至`);
        } else if (productionCost !== null && close >= productionCost * 1.3) {
            score = 10;
            action = "绝对摸顶区";
            risks.push(`最新价(${close})超出生产成本线(${productionCost})30%以上，行业利润极其丰厚，谨防供给快速释放`);
        } else {
            action = "中位震荡";
            reasons.push(`最新价(${close})处于成本线(${productionCost || '-'})与现金成本(${cashCost || '-'})上方，估值中性`);
        }
    } else {
        action = "中位震荡";
        risks.push("缺少生产成本及现金流成本参考数据，无法进行左侧周期定位");
    }

    if (row.basisComparable === true && Number.isFinite(row.basis)) {
        signals.basis = row.basis;
        signals.basisRate = row.basisRate;
        if (row.basis > 0) {
            const bonus = Math.min(10, (row.basis / (close || 1)) * 50);
            score += bonus;
            reasons.push(`期货贴水现货，基差为+${row.basis}，提供额外现期收敛拉力`);
        } else if (row.basis < 0) {
            const penalty = Math.min(15, (Math.abs(row.basis) / (close || 1)) * 50);
            score -= penalty;
            risks.push(`期货升水现货，基差为${row.basis}，透支左侧上涨空间`);
        }
    }

    const advice = action === "绝对抄底区" ? "死守认错线，大周期持有不动，静待供给侧出清"
                 : action === "生产成本线" ? "生产成本附近，左侧轻仓布局，跌破现金成本认错"
                 : action === "绝对摸顶区" ? "企业暴利区，只空不买，突破近5日高点或行业利润继续走高认错"
                 : "估值中性，散户不参与灰色震荡，拿着现金不动";

    signals.leftSide = {
        state: action,
        advice: advice,
        tags: [action],
        bottom: { score: score, action: action, rangePosition: null, rangeLow: null, rangeHigh: null },
        top: { score: score, action: action, upperShadowRatio: null }
    };
    signals.multiDay = { tags: [action], notes: reasons };
    signals.turnover = null;

    const confidence = score >= 80 ? "高" : score >= 60 ? "中" : "低";
    const actionLabel = score >= 70 ? "大周期做多/抄底" : score <= 20 ? "大周期做空/摸顶" : "观望/拿着不动";

    return {
        code,
        name: row.name || code,
        contract: row.contract || null,
        close,
        previousSettlement: row.previousSettlement || null,
        score: Math.round(score * 100) / 100,
        action: actionLabel,
        confidence,
        signals,
        reasons,
        risks,
        qualityWarnings: row.qualityWarnings || []
    };
}

function buildLongCandidates(mergedData, history) {
    return Object.entries(mergedData)
        .map(([code, row]) => scoreLongCandidate(code, row, getRecentRows(history, code, 5)))
        .sort((a, b) => b.score - a.score);
}

function escapeMarkdown(value) {
    return String(value ?? "-")
        .replace(/\r?\n/g, " ")
        .replace(/\|/g, "\\|")
        .trim() || "-";
}

function formatPct(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
}

function formatMoney(value) {
    return Number.isFinite(value) ? String(round(value, 2)) : "-";
}

function badge(text, type) {
    const styles = {
        long: "background:#dcfce7;color:#166534;border:1px solid #86efac",
        watch: "background:#fef9c3;color:#854d0e;border:1px solid #fde047",
        weak: "background:#f3f4f6;color:#374151;border:1px solid #d1d5db",
        risk: "background:#fee2e2;color:#991b1b;border:1px solid #fecaca",
        signal: "background:#e0f2fe;color:#075985;border:1px solid #7dd3fc"
    };
    return `<span style="${styles[type] || styles.weak};padding:2px 6px;border-radius:6px;font-weight:600;white-space:nowrap">${escapeMarkdown(text)}</span>`;
}

function actionType(score) {
    if (score >= 70) return "long";
    if (score <= 20) return "risk";
    return "weak";
}

function buildMarkdownReport(candidates, mergedData, history) {
    const updateTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const longCount = candidates.filter(item => item.score >= 70).length;
    const watchCount = candidates.filter(item => item.score > 20 && item.score < 70).length;
    const weakCount = candidates.filter(item => item.score <= 20).length;
    const lines = [];

    lines.push("# 期货盘面筛选报告");
    lines.push("");
    lines.push(`更新时间：${updateTime}`);
    lines.push("");
    lines.push("> 自动评分纯粹以生产成本、现金流底线和现货基差为核心；去除一切滞后性技术指标，完全符合大周期左侧交易哲学。");
    lines.push("");
    lines.push("## 总览");
    lines.push("");
    lines.push(`- 大周期抄底/做多：${longCount}`);
    lines.push(`- 估值中性观望：${watchCount}`);
    lines.push(`- 大周期摸顶/做空：${weakCount}`);
    lines.push(`- 数据文件：market_data.json、long_candidates.json、history/market_snapshots.json`);
    lines.push("");
    lines.push("## 全部品种");
    lines.push("");
    lines.push("| 排名 | 品种 | 合约 | 评分 | 方向 | 现价 | 现货价 | 现金成本 | 生产成本 | 基差 | 核心原因 | 主要风险 |");
    lines.push("|---:|---|---|---:|---|---:|---:|---:|---:|---:|---|---|");

    candidates.forEach((item, index) => {
        const row = mergedData[item.code] || {};
        lines.push(`| ${index + 1} | ${escapeMarkdown(`${item.code} ${item.name || ""}`)} | ${escapeMarkdown(item.contract || "-")} | ${item.score} | ${badge(item.action, actionType(item.score))} | ${item.close ?? "-"} | ${row.spotPrice ?? "-"} | ${formatMoney(row.cashCost)} | ${formatMoney(row.productionCost)} | ${row.basis ?? "-"} | ${escapeMarkdown(item.reasons[0] || "估值中性，建议观望")} | ${escapeMarkdown(item.risks[0] || "暂无主要风险")} |`);
    });

    lines.push("");
    lines.push("## 品种明细");
    for (const item of candidates) {
        const row = mergedData[item.code] || {};
        const leftSide = item.signals?.leftSide || {};
        lines.push("");
        lines.push(`### ${escapeMarkdown(item.code)} ${escapeMarkdown(item.name || "")} ${escapeMarkdown(item.contract || "")}`);
        lines.push("");
        lines.push(`结论：${badge(item.action, actionType(item.score))} 评分：${item.score} 置信度：${escapeMarkdown(item.confidence)}`);
        lines.push("");
        lines.push("| 指标 | 数值 |");
        lines.push("|---|---:|");
        lines.push(`| 最新价 | ${item.close ?? "-"} |`);
        lines.push(`| 较昨结涨跌 | ${formatPct(row.priceChangePct)} |`);
        lines.push(`| 现货价格 | ${row.spotPrice ?? "-"} |`);
        lines.push(`| 现金成本 | ${formatMoney(row.cashCost)} |`);
        lines.push(`| 生产成本 | ${formatMoney(row.productionCost)} |`);
        lines.push(`| 产业利润 | ${formatMoney(row.industrialProfit)} |`);
        lines.push(`| 年产量 | ${escapeMarkdown(row.annualProduction)} |`);
        lines.push(`| 年消费量 | ${escapeMarkdown(row.annualConsumption)} |`);
        lines.push(`| 供需格局 | ${escapeMarkdown(row.supplyDemandBalance)} |`);
        lines.push(`| 基差 | ${row.basis ?? "-"} |`);
        lines.push(`| 仓单 | ${row.warrant ?? "-"} |`);
        lines.push("");
        lines.push("研判依据：");
        const reasons = item.reasons.length ? item.reasons.slice(0, 5) : ["估值中性，建议观望"];
        for (const reason of reasons) lines.push(`- ${escapeMarkdown(reason)}`);
        lines.push("");
        lines.push("主要风险：");
        const risks = item.risks.length ? item.risks.slice(0, 5) : ["暂无主要风险"];
        for (const risk of risks) lines.push(`- ${escapeMarkdown(risk)}`);
    }

    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("说明：本报告只做研究辅助，不构成投资建议或交易指令。");
    lines.push("");
    return lines.join("\n");
}

function escapeHtml(value) {
    return String(value ?? "-")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function htmlBadge(text, type) {
    return `<span class="badge ${escapeHtml(type)}">${escapeHtml(text)}</span>`;
}

function pctClass(value) {
    if (!Number.isFinite(value)) return "";
    if (value > 0) return "up";
    if (value < 0) return "down";
    return "";
}

function buildHtmlReport(candidates, mergedData, history) {
    const updateTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const longCount = candidates.filter(item => item.score >= 70).length;
    const watchCount = candidates.filter(item => item.score > 20 && item.score < 70).length;
    const weakCount = candidates.filter(item => item.score <= 20).length;

    const rows = candidates.map((item, index) => {
        const row = mergedData[item.code] || {};
        const leftSide = item.signals?.leftSide || {};
        const changePct = formatPct(row.priceChangePct);
        const leftType = actionType(item.score);
        
        const basisVal = row.basis ?? 0;
        const basisSign = basisVal > 0 ? `+${basisVal}` : `${basisVal}`;
        const basisText = row.basis !== null ? `<span class="muted" style="font-size:12px;">基差: ${basisSign}</span>` : "-";
        
        return `
            <tr class="${actionType(item.score)}">
                <td class="rank">${index + 1}</td>
                <td>
                    <strong>${escapeHtml(item.name || item.code)}</strong><br>
                    <span class="muted" style="font-size:12px;">${escapeHtml(item.contract || "-")}</span>
                </td>
                <td class="score">${escapeHtml(item.score)}</td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
                        ${htmlBadge(item.action, actionType(item.score))}
                        ${htmlBadge(leftSide.state || "-", leftType)}
                    </div>
                </td>
                <td class="num">
                    <strong>${escapeHtml(item.close ?? "-")}</strong><br>
                    <span class="${pctClass(row.priceChangePct)}" style="font-size:12px;">${escapeHtml(changePct)}</span>
                </td>
                <td class="num">
                    <strong>${escapeHtml(row.spotPrice ?? "-")}</strong><br>
                    ${basisText}
                </td>
                <td class="num">
                    <span style="font-size:12px;">现: ${escapeHtml(formatMoney(row.cashCost))}</span><br>
                    <span class="muted" style="font-size:12px;">全: ${escapeHtml(formatMoney(row.productionCost))}</span>
                </td>
                <td class="num ${Number.isFinite(row.industrialProfit) && row.industrialProfit < 0 ? 'down' : Number.isFinite(row.industrialProfit) && row.industrialProfit > 0 ? 'up' : ''}">
                    <strong>${escapeHtml(formatMoney(row.industrialProfit))}</strong>
                </td>
                <td>
                    <span style="font-size:13px; font-weight:700;">${escapeHtml(row.annualProduction)} / ${escapeHtml(row.annualConsumption)}</span><br>
                    <span class="muted" style="font-size:11px; display:inline-block; line-height:1.2; margin-top:2px;">${escapeHtml(row.supplyDemandBalance)}</span>
                </td>
                <td><small>${escapeHtml(item.reasons[0] || "估值中性，建议观望")}</small></td>
                <td><small>${escapeHtml(leftSide.advice || item.risks[0] || "暂无主要风险")}</small></td>
            </tr>`;
    }).join("");

    const details = candidates.map(item => {
        const row = mergedData[item.code] || {};
        const leftSide = item.signals?.leftSide || {};
        const reasons = (item.reasons.length ? item.reasons.slice(0, 5) : ["估值中性，建议观望"])
            .map(reason => `<li>${escapeHtml(reason)}</li>`).join("");
        const risks = (item.risks.length ? item.risks.slice(0, 5) : ["暂无主要风险"])
            .map(risk => `<li>${escapeHtml(risk)}</li>`).join("");

        return `
            <details class="detail-card ${actionType(item.score)}">
                <summary>
                    <span><strong>${escapeHtml(item.code)}</strong> ${escapeHtml(item.name || "")} ${escapeHtml(item.contract || "")}</span>
                    <span>${htmlBadge(item.action, actionType(item.score))}<b class="score-pill">${escapeHtml(item.score)}</b></span>
                </summary>
                <div class="detail-grid">
                    <section>
                        <h3>核心指标</h3>
                        <table class="mini">
                            <tr><th>最新价</th><td>${escapeHtml(item.close ?? "-")}</td></tr>
                            <tr><th>较昨结涨跌</th><td class="${pctClass(row.priceChangePct)}">${escapeHtml(formatPct(row.priceChangePct))}</td></tr>
                            <tr><th>现货价格</th><td>${escapeHtml(row.spotPrice ?? "-")}</td></tr>
                            <tr><th>现金成本</th><td>${escapeHtml(formatMoney(row.cashCost))}</td></tr>
                            <tr><th>生产成本</th><td>${escapeHtml(formatMoney(row.productionCost))}</td></tr>
                            <tr><th>基差</th><td class="${row.basis > 0 ? 'up' : row.basis < 0 ? 'down' : ''}">${escapeHtml(row.basis ?? "-")}</td></tr>
                            <tr><th>产业利润</th><td class="${Number.isFinite(row.industrialProfit) && row.industrialProfit < 0 ? 'down' : Number.isFinite(row.industrialProfit) && row.industrialProfit > 0 ? 'up' : ''}">${escapeHtml(formatMoney(row.industrialProfit))}</td></tr>
                            <tr><th>利润率</th><td>${escapeHtml(formatPct(row.industrialProfitRate))}</td></tr>
                            <tr><th>年产量</th><td>${escapeHtml(row.annualProduction)}</td></tr>
                            <tr><th>年消费量</th><td>${escapeHtml(row.annualConsumption)}</td></tr>
                            <tr><th>供需格局</th><td>${escapeHtml(row.supplyDemandBalance)}</td></tr>
                            <tr><th>利润口径</th><td>${escapeHtml(row.profitNote || "-")}</td></tr>
                            <tr><th>左侧定位</th><td>${escapeHtml(leftSide.state || "-")}</td></tr>
                            <tr><th>仓单</th><td>${escapeHtml(row.warrant ?? "-")}</td></tr>
                        </table>
                    </section>
                    <section>
                        <h3>研判依据</h3>
                        <ul>${reasons}</ul>
                        <h3>主要风险</h3>
                        <ul>${risks}</ul>
                        <h3>长线计划</h3>
                        <p class="advice">${escapeHtml(leftSide.advice || "-")}</p>
                    </section>
                </div>
            </details>`;
    }).join("");

    return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>期货大周期左侧筛选报告</title>
    <style>
        :root { color-scheme: light; --bg:#f6f7f9; --panel:#fff; --text:#111827; --muted:#6b7280; --line:#e5e7eb; }
        * { box-sizing: border-box; }
        body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
        .wrap { max-width: 1480px; margin: 0 auto; padding: 24px; }
        header { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; margin-bottom:18px; }
        h1 { margin:0; font-size:28px; letter-spacing:0; }
        .sub { color:var(--muted); margin-top:6px; }
        .cards { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px; margin:18px 0; }
        .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px 16px; }
        .card b { display:block; font-size:26px; }
        .note { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; border-radius:8px; padding:12px 14px; margin-bottom:16px; }
        .advice { margin:0; padding:10px 12px; background:#f8fafc; border:1px solid var(--line); border-radius:8px; font-weight:700; }
        .table-panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:auto; width:100%; }
        table { width:100%; min-width:1450px; border-collapse:collapse; table-layout: fixed; }
        th, td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:middle; word-wrap: break-word; }
        th { position:sticky; top:0; background:#f9fafb; z-index:1; color:#374151; font-weight:700; white-space:nowrap; }
        td { min-width:60px; }
        /* Explicit Column Width Control */
        th:nth-child(1), td:nth-child(1) { width: 50px; }   /* 排名 */
        th:nth-child(2), td:nth-child(2) { width: 120px; }  /* 品种合约 */
        th:nth-child(3), td:nth-child(3) { width: 60px; }   /* 评分 */
        th:nth-child(4), td:nth-child(4) { width: 160px; }  /* 方向(状态) */
        th:nth-child(5), td:nth-child(5) { width: 90px; }   /* 最新价(涨跌) */
        th:nth-child(6), td:nth-child(6) { width: 95px; }   /* 现货价(基差) */
        th:nth-child(7), td:nth-child(7) { width: 110px; }  /* 成本线(现金/完全) */
        th:nth-child(8), td:nth-child(8) { width: 80px; }   /* 产业利润 */
        th:nth-child(9), td:nth-child(9) { width: 190px; }  /* 产业供需(年供需/格局) */
        th:nth-child(10), td:nth-child(10) { width: 270px; } /* 核心原因 */
        th:nth-child(11), td:nth-child(11) { width: 230px; } /* 长线计划 */
        .num, .score, .rank { text-align:right; font-variant-numeric: tabular-nums; }
        .score { font-weight:800; }
        .muted { color:var(--muted); }
        .up { color:#dc2626; font-weight:700; }
        .down { color:#059669; font-weight:700; }
        .badge { display:inline-flex; align-items:center; margin:2px 4px 2px 0; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:700; white-space:nowrap; border:1px solid transparent; }
        .badge.long { background:#dcfce7; color:#166534; border-color:#86efac; }
        .badge.watch { background:#fef9c3; color:#854d0e; border-color:#fde047; }
        .badge.weak { background:#f3f4f6; color:#374151; border-color:#d1d5db; }
        .badge.risk { background:#fee2e2; color:#991b1b; border-color:#fecaca; }
        tr.long { background:#f8fff9; }
        tr.watch { background:#fffdf2; }
        tr.risk { background:#fff7f7; }
        .details { margin-top:18px; display:grid; gap:10px; }
        .detail-card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:0; overflow:hidden; }
        .detail-card summary { cursor:pointer; display:flex; justify-content:space-between; gap:12px; align-items:center; padding:12px 14px; list-style:none; }
        .detail-card summary::-webkit-details-marker { display:none; }
        .score-pill { margin-left:8px; background:#111827; color:white; border-radius:999px; padding:2px 8px; font-size:12px; }
        .detail-grid { display:grid; grid-template-columns: 340px 1fr; gap:16px; padding:0 14px 14px; border-top:1px solid var(--line); }
        h2 { margin:22px 0 10px; font-size:20px; }
        h3 { margin:14px 0 8px; font-size:15px; }
        ul { margin:0; padding-left:18px; }
        .mini th, .mini td { padding:7px 8px; }
        .mini th { position:static; }
        footer { color:var(--muted); margin:22px 0 4px; }
        @media (max-width: 980px) {
            .wrap { padding:14px; }
            header { display:block; }
            .cards { grid-template-columns: repeat(2, minmax(0,1fr)); }
            .detail-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <main class="wrap">
        <header>
            <div>
                <h1>期货大周期左侧筛选报告</h1>
                <div class="sub">更新时间：${escapeHtml(updateTime)}</div>
            </div>
            <div class="sub">数据源：新浪行情 / 生意社基差 / 东财仓单</div>
        </header>
        <section class="cards">
            <div class="card"><span>监控品种</span><b>${candidates.length}</b></div>
            <div class="card"><span>大周期做多/抄底</span><b>${longCount}</b></div>
            <div class="card"><span>估值中性观望</span><b>${watchCount}</b></div>
            <div class="card"><span>大周期做空/摸顶</span><b>${weakCount}</b></div>
        </section>
        <div class="note"><b>左侧逻辑提示：</b>自动评分纯粹以生产成本、现金流底线和现货基差为核心，剔除一切趋势追踪等滞后性技术指标，践行“买在行业大亏损、卖在行业大暴利”的长线左侧逻辑。</div>
        <section class="table-panel">
            <table>
                <thead>
                    <tr><th>排名</th><th>品种/合约</th><th>评分</th><th>方向 (左侧状态)</th><th>最新价</th><th>现货 (基差)</th><th>成本线(现/全)</th><th>产业利润</th><th>产业供需(年产量/消费)</th><th>核心原因</th><th>长线计划</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </section>
        <h2>品种明细</h2>
        <section class="details">${details}</section>
        <footer>本报告只做研究辅助，不构成投资建议或交易指令。</footer>
    </main>
</body>
</html>`;
}

// 4. 合并数据并写入文件
async function sync() {
    console.log("========================================");
    console.log("开始大周期左侧估值数据同步 (新浪价格 + 生意社基差 + 东财仓单日报)...");
    try {
        const [prices, basis, warrants] = await Promise.all([
            safeCall("新浪行情", getSinaPrices, {}),
            safeCall("生意社基差", getSunsirsBasis, {}),
            safeCall("东财仓单", getEastmoneyWarrants, {})
        ]);
        const mergedData = {};
        const allKeys = new Set([
            ...Object.keys(prices),
            ...Object.keys(basis),
            ...Object.keys(warrants)
        ]);
        
        for (const code of allKeys) {
            const row = {
                code,
                ...(CONTRACT_SPECS[code] || {}),
                ...(prices[code] || {}),
                ...(basis[code] || { spotPrice: null, basis: null, basisRate: null, basisComparable: null, basisQualityNote: null }),
                ...(warrants[code] || { warrant: null, warrantChange: null, warrant5dChange: null, warrantDate: null, warrantLots: null, warrantHistory: [] }),
                annualProduction: SUPPLY_DEMAND_DATA[code]?.production || "-",
                annualConsumption: SUPPLY_DEMAND_DATA[code]?.consumption || "-",
                supplyDemandBalance: SUPPLY_DEMAND_DATA[code]?.balance || "-",
                update_time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
            };
            
            // Fallback spot price & basis calculation for missing commodities
            if (row.spotPrice === null && FALLBACK_SPOT_PRICES[code]) {
                row.spotPrice = FALLBACK_SPOT_PRICES[code];
                if (row.close !== null) {
                    row.basis = row.spotPrice - row.close;
                    row.basisRate = `${((row.basis / row.spotPrice) * 100).toFixed(2)}%`;
                    row.basisComparable = true;
                }
            }
            
            row.qualityWarnings = buildQualityWarnings(code, row);
            mergedData[code] = row;
        }

        const profits = await safeCall("产业利润", () => getIndustryProfits(mergedData), {});
        for (const [code, profit] of Object.entries(profits)) {
            if (!mergedData[code]) continue;
            Object.assign(mergedData[code], profit);
        }
        for (const [code, row] of Object.entries(mergedData)) {
            row.qualityWarnings = buildQualityWarnings(code, row);
        }
        
        let history = saveHistory(loadHistory(), mergedData);
        history = await backfillRecentDailyHistory(mergedData, history);

        const outputPath = path.join(__dirname, 'market_data.json');
        fs.writeFileSync(outputPath, JSON.stringify(mergedData, null, 4), 'utf8');

        const candidates = buildLongCandidates(mergedData, history);
        const candidatesPath = path.join(__dirname, 'long_candidates.json');
        fs.writeFileSync(candidatesPath, JSON.stringify({
            update_time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            note: "自动评分纯粹以生产成本、现金底和现货基差为核心；已剔除技术指标。",
            candidates
        }, null, 4), 'utf8');

        const reportPath = path.join(__dirname, 'futures_report.html');
        fs.writeFileSync(reportPath, buildHtmlReport(candidates, mergedData, history), 'utf8');

        const mdReportPath = path.join(__dirname, 'futures_report.md');
        fs.writeFileSync(mdReportPath, buildMarkdownReport(candidates, mergedData, history), 'utf8');
        
        console.log(`\n【同步成功】数据已保存至: ${outputPath}`);
        console.log(`【筛选成功】多头候选已保存至: ${candidatesPath}`);
        console.log(`【报告生成】HTML报告已保存至: ${reportPath}`);
        console.log(`【报告生成】Markdown报告已保存至: ${mdReportPath}`);
        console.log(`共更新了 ${Object.keys(mergedData).length} 个品种的 行情、基差 及 仓单日报数据。`);
        
        const CODE_TO_NAME = {};
        for (const [name, code] of Object.entries(NAME_TO_CODE)) {
            if (name !== '鲜苹果') {
                CODE_TO_NAME[code] = name;
            }
        }

        console.log("全部品种大周期估值左侧筛选：");
        for (const item of candidates) {
            const cnName = CODE_TO_NAME[item.code] || "";
            const mainReason = item.reasons[0] || "估值中性，建议观望";
            const mainRisk = item.risks[0] || "暂无主要风险";
            const advice = item.signals?.leftSide?.advice || "";
            console.log(`${item.code.padEnd(3)} ${String(item.score).padStart(6)} ${item.action} | ${cnName} ${item.contract || ""} close=${item.close} | 估值状态=${item.signals?.leftSide?.state || "-"} | 说明: ${mainReason} | 计划: ${advice}`);
        }
        console.log("========================================");
    } catch (e) {
        console.error("同步失败:", e);
    }
}

sync();
