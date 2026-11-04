/**
 * Chinese pinyin conversion for search fallback, with zero runtime dependencies.
 *
 * Data and algorithm are adapted from tiny-pinyin 1.3.2 (MIT), which in turn
 * credits Android ContactsProvider HanziToPinyin (Apache-2.0). The tables cover
 * 6763 common Han characters; rare characters fall through unchanged. There is
 * no polyphone disambiguation: one reading per character, so pinyin search is a
 * best-effort fallback, never the primary ranker. See PINYIN-NOTICE.md.
 *
 * Conversion uses `Intl.Collator(['zh-Hans-CN','zh-CN'])` to binary-search the
 * anchor table, exactly like tiny-pinyin. `pinyinAvailable()` is false when the
 * runtime has no zh collation, and callers must then skip the fallback.
 */
const UNIHANS = ["阿","哎","安","肮","凹","八","挀","扳","邦","勹","陂","奔","伻","屄","边","灬","憋","汃","冫","癶","峬","嚓","偲","参","仓","撡","冊","嵾","曽","叉","芆","辿","伥","抄","车","抻","阷","吃","充","抽","出","欻","揣","巛","刅","吹","旾","逴","呲","匆","凑","粗","汆","崔","邨","搓","咑","呆","丹","当","刀","嘚","扥","灯","氐","甸","刁","爹","丁","丟","东","吺","厾","耑","垖","吨","多","妸","诶","奀","鞥","儿","发","帆","匚","飞","分","丰","覅","仏","紑","夫","旮","侅","甘","冈","皋","戈","给","根","刯","工","勾","估","瓜","乖","关","光","归","丨","呙","哈","咍","佄","夯","茠","诃","黒","拫","亨","噷","叿","齁","乎","花","怀","欢","巟","灰","昏","吙","丌","加","戋","江","艽","阶","巾","坕","冂","丩","凥","姢","噘","军","咔","开","刊","忼","尻","匼","肎","劥","空","抠","扝","夸","蒯","宽","匡","亏","坤","扩","垃","来","兰","啷","捞","肋","勒","崚","哩","俩","奁","良","撩","毟","拎","伶","溜","囖","龙","瞜","噜","驴","娈","掠","抡","罗","呣","妈","埋","嫚","牤","猫","么","呅","门","甿","咪","宀","喵","乜","民","名","谬","摸","哞","毪","嗯","拏","腉","囡","囔","孬","疒","娞","恁","能","妮","拈","娘","鸟","捏","囜","宁","妞","农","羺","奴","女","奻","疟","黁","挪","喔","讴","妑","拍","眅","乓","抛","呸","喷","匉","丕","囨","剽","氕","姘","乒","钋","剖","仆","七","掐","千","呛","悄","癿","亲","靑","卭","丘","区","峑","缺","夋","呥","穣","娆","惹","人","扔","日","茸","厹","邚","挼","堧","婑","瞤","捼","仨","毢","三","桒","掻","閪","森","僧","杀","筛","山","伤","弰","奢","申","升","尸","収","书","刷","衰","闩","双","脽","吮","说","厶","忪","捜","苏","狻","夊","孙","唆","他","囼","坍","汤","夲","忑","熥","剔","天","旫","帖","厅","囲","偷","凸","湍","推","吞","乇","穵","歪","弯","尣","危","昷","翁","挝","乌","夕","虲","仙","乡","灱","些","心","星","凶","休","吁","吅","削","坃","丫","恹","央","幺","倻","一","囙","应","哟","佣","优","扜","囦","曰","晕","帀","災","兂","匨","傮","则","贼","怎","増","扎","捚","沾","张","佋","蜇","贞","争","之","中","州","朱","抓","拽","专","妆","隹","宒","卓","乲","宗","邹","租","钻","厜","尊","昨","兙"];
const PINYINS = ["A","AI","AN","ANG","AO","BA","BAI","BAN","BANG","BAO","BEI","BEN","BENG","BI","BIAN","BIAO","BIE","BIN","BING","BO","BU","CA","CAI","CAN","CANG","CAO","CE","CEN","CENG","CHA","CHAI","CHAN","CHANG","CHAO","CHE","CHEN","CHENG","CHI","CHONG","CHOU","CHU","CHUA","CHUAI","CHUAN","CHUANG","CHUI","CHUN","CHUO","CI","CONG","COU","CU","CUAN","CUI","CUN","CUO","DA","DAI","DAN","DANG","DAO","DE","DEN","DENG","DI","DIAN","DIAO","DIE","DING","DIU","DONG","DOU","DU","DUAN","DUI","DUN","DUO","E","EI","EN","ENG","ER","FA","FAN","FANG","FEI","FEN","FENG","FIAO","FO","FOU","FU","GA","GAI","GAN","GANG","GAO","GE","GEI","GEN","GENG","GONG","GOU","GU","GUA","GUAI","GUAN","GUANG","GUI","GUN","GUO","HA","HAI","HAN","HANG","HAO","HE","HEI","HEN","HENG","HM","HONG","HOU","HU","HUA","HUAI","HUAN","HUANG","HUI","HUN","HUO","JI","JIA","JIAN","JIANG","JIAO","JIE","JIN","JING","JIONG","JIU","JU","JUAN","JUE","JUN","KA","KAI","KAN","KANG","KAO","KE","KEN","KENG","KONG","KOU","KU","KUA","KUAI","KUAN","KUANG","KUI","KUN","KUO","LA","LAI","LAN","LANG","LAO","LE","LEI","LENG","LI","LIA","LIAN","LIANG","LIAO","LIE","LIN","LING","LIU","LO","LONG","LOU","LU","LV","LUAN","LVE","LUN","LUO","M","MA","MAI","MAN","MANG","MAO","ME","MEI","MEN","MENG","MI","MIAN","MIAO","MIE","MIN","MING","MIU","MO","MOU","MU","N","NA","NAI","NAN","NANG","NAO","NE","NEI","NEN","NENG","NI","NIAN","NIANG","NIAO","NIE","NIN","NING","NIU","NONG","NOU","NU","NV","NUAN","NVE","NUN","NUO","O","OU","PA","PAI","PAN","PANG","PAO","PEI","PEN","PENG","PI","PIAN","PIAO","PIE","PIN","PING","PO","POU","PU","QI","QIA","QIAN","QIANG","QIAO","QIE","QIN","QING","QIONG","QIU","QU","QUAN","QUE","QUN","RAN","RANG","RAO","RE","REN","RENG","RI","RONG","ROU","RU","RUA","RUAN","RUI","RUN","RUO","SA","SAI","SAN","SANG","SAO","SE","SEN","SENG","SHA","SHAI","SHAN","SHANG","SHAO","SHE","SHEN","SHENG","SHI","SHOU","SHU","SHUA","SHUAI","SHUAN","SHUANG","SHUI","SHUN","SHUO","SI","SONG","SOU","SU","SUAN","SUI","SUN","SUO","TA","TAI","TAN","TANG","TAO","TE","TENG","TI","TIAN","TIAO","TIE","TING","TONG","TOU","TU","TUAN","TUI","TUN","TUO","WA","WAI","WAN","WANG","WEI","WEN","WENG","WO","WU","XI","XIA","XIAN","XIANG","XIAO","XIE","XIN","XING","XIONG","XIU","XU","XUAN","XUE","XUN","YA","YAN","YANG","YAO","YE","YI","YIN","YING","YO","YONG","YOU","YU","YUAN","YUE","YUN","ZA","ZAI","ZAN","ZANG","ZAO","ZE","ZEI","ZEN","ZENG","ZHA","ZHAI","ZHAN","ZHANG","ZHAO","ZHE","ZHEN","ZHENG","ZHI","ZHONG","ZHOU","ZHU","ZHUA","ZHUAI","ZHUAN","ZHUANG","ZHUI","ZHUN","ZHUO","ZI","ZONG","ZOU","ZU","ZUAN","ZUI","ZUN","ZUO",""];
const EXCEPTIONS = {"曾":"ZENG","沈":"SHEN","嗲":"DIA","碡":"ZHOU","聒":"GUO","炔":"QUE","蚵":"KE","砉":"HUA","嬤":"MO","嬷":"MO","蹒":"PAN","蹊":"XI","丬":"PAN","霰":"XIAN","莘":"XIN","豉":"CHI","饧":"XING","筠":"JUN","长":"CHANG","帧":"ZHEN","峙":"SHI","郍":"NA","芎":"XIONG","谁":"SHUI"};

const FIRST_HAN = '\u963F';
const LAST_HAN = '\u9FFF';
const LATIN = /^[a-z0-9]$/i;
const HAN = /^[\u3400-\u9fff]$/;

let collator;
let collatorReady = false;
function getCollator() {
  if (collatorReady) return collator;
  collatorReady = true;
  try {
    if (typeof Intl === 'undefined' || !Intl.Collator) return (collator = null);
    if (Intl.Collator.supportedLocalesOf(['zh-CN']).length !== 1) return (collator = null);
    collator = new Intl.Collator(['zh-Hans-CN', 'zh-CN']);
  } catch {
    collator = null;
  }
  return collator;
}

/** True when the runtime can convert Han characters to pinyin. */
export function pinyinAvailable() {
  return Boolean(getCollator());
}

const charCache = new Map();
/** Pinyin (upper-case, no tone) for one Han character, or '' if unknown. */
export function pinyinOfChar(ch) {
  if (charCache.has(ch)) return charCache.get(ch);
  let result = '';
  const c = getCollator();
  if (c && HAN.test(ch)) {
    if (Object.prototype.hasOwnProperty.call(EXCEPTIONS, ch)) {
      result = EXCEPTIONS[ch];
    } else {
      const cmpFirst = c.compare(ch, FIRST_HAN);
      const cmpLast = c.compare(ch, LAST_HAN);
      if (cmpFirst >= 0 && cmpLast <= 0) {
        let begin = 0;
        let end = UNIHANS.length - 1;
        let offset = -1;
        let cmp = 0;
        while (begin <= end) {
          offset = Math.floor((begin + end) / 2);
          cmp = c.compare(ch, UNIHANS[offset]);
          if (cmp === 0) break;
          if (cmp > 0) begin = offset + 1;
          else end = offset - 1;
        }
        if (cmp < 0) offset -= 1;
        result = PINYINS[offset] || '';
      }
    }
  }
  charCache.set(ch, result);
  return result;
}

/**
 * Convert text to a compact pinyin form for substring matching.
 * - `full`: every Han character as a lower-case syllable, other letters/digits
 *   kept as-is; punctuation and spaces dropped (so "记忆" → "jiyi").
 * - `initials`: first letter per Han character, other alphanumerics kept.
 *   "记忆" → "jy". Latin runs are kept whole in both strings.
 * - `converted`: number of Han characters that had a reading.
 *
 * The concat form intentionally allows false-positive substring hits; pinyin
 * results are appended only after literal ranking, at a lower rank.
 */
export function toPinyin(text, options = {}) {
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : 20000;
  const chars = [...String(text || '').slice(0, maxChars)];
  let full = '';
  let initials = '';
  let converted = 0;
  for (const ch of chars) {
    if (HAN.test(ch)) {
      const py = pinyinOfChar(ch);
      if (py) {
        full += py.toLowerCase();
        initials += py[0].toLowerCase();
        converted += 1;
      } else {
        full += ch;
        initials += ch;
      }
    } else if (/[a-z0-9]/i.test(ch)) {
      full += ch.toLowerCase();
      initials += ch.toLowerCase();
    } else if (LATIN.test(ch)) {
      full += ch;
      initials += ch;
    }
    // Everything else (spaces, punctuation, emoji) is a boundary and is dropped.
  }
  return { full, initials, converted };
}
