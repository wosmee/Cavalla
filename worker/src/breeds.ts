// Породный профиль Cavalla: RU-имена и алиасы (с частыми опечатками) → класс размера.
// Чистые данные + матчинг; применяет cycle.ts. Порядок важен: первый сматченный ключ
// выигрывает, поэтому составные имена идут раньше слов-«одиночек» своей группы
// («немецкая овчарка» до «овчарка», «вельш корги пемброк» до «корги»).
// Матчинг подстрокой по нормализованной строке: «-» → пробел, без ё/ъ/ь, нижний регистр.

export type SizeClass = "small" | "medium" | "large" | "giant" | "annual" | "unknown";

export interface BreedProfile {
  sizeClass: SizeClass;
  intervalDays: number;        // типичный интервал между течками (приор при ≤1 интервале)
  firstHeatLateMonths: number; // порог «пора бы первой течке»
  intervalLongAlert: number;   // порог тревоги «интервал слишком длинный»
  intervalShortAlert: number;  // порог тревоги «интервал подозрительно короткий»
}

// Класс → профиль. unknown = глобальные дефолты (как до волны 5).
export const SIZE_PROFILES: Record<SizeClass, BreedProfile> = {
  small:   { sizeClass: "small",   intervalDays: 160, firstHeatLateMonths: 12, intervalLongAlert: 300, intervalShortAlert: 90 },
  medium:  { sizeClass: "medium",  intervalDays: 180, firstHeatLateMonths: 14, intervalLongAlert: 365, intervalShortAlert: 100 },
  large:   { sizeClass: "large",   intervalDays: 210, firstHeatLateMonths: 18, intervalLongAlert: 400, intervalShortAlert: 100 },
  giant:   { sizeClass: "giant",   intervalDays: 280, firstHeatLateMonths: 22, intervalLongAlert: 450, intervalShortAlert: 120 },
  annual:  { sizeClass: "annual",  intervalDays: 340, firstHeatLateMonths: 18, intervalLongAlert: 450, intervalShortAlert: 150 },
  unknown: { sizeClass: "unknown", intervalDays: 180, firstHeatLateMonths: 18, intervalLongAlert: 365, intervalShortAlert: 100 },
};

// нормализация: нижний регистр, ё→е, без ъ/ь, дефисы → пробел, пробелы схлопнуты
export function normalizeBreed(s: string): string {
  return s.toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[ъь]/g, "")
    .replace(/[-–—_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// класс по весу (граммы). Опора, если порода не распознана.
export function sizeClassByWeight(weightGrams: number | null | undefined): SizeClass | null {
  if (!weightGrams || weightGrams < 2000 || weightGrams > 90000) return null;
  const kg = weightGrams / 1000;
  if (kg < 10) return "small";
  if (kg < 25) return "medium";
  if (kg < 45) return "large";
  return "giant";
}

const BREED_MAP: [string, SizeClass][] = [
  // --- мелкие (до ~10 кг) ---
  ["чихуахуа", "small"], ["чихуаху", "small"], ["чикхуахуа", "small"], ["чихуахуенька", "small"],
  ["чихуа", "small"], ["чиху", "small"], ["чих", "small"],
  ["померански шпиц", "small"], ["мини шпиц", "small"], ["микро шпиц", "small"],
  ["померански", "small"], ["померанец", "small"], ["померан", "small"],
  ["японски шпиц", "small"], ["немецки шпиц", "small"], ["шпиц", "small"],
  ["йорширски терер", "small"], ["йоркширски терер", "small"], ["йоркширскии терер", "small"],
  ["йоркширская", "small"], ["йоркшир", "small"], ["мини йорк", "small"], ["микро йорк", "small"],
  ["бивер йорк", "small"], ["бивер", "small"], ["йорк", "small"], ["йорки", "small"],
  ["мальтезе", "small"], ["мальтийска болонка", "small"], ["мальтийская болонка", "small"],
  ["мальтис", "small"], ["мальтипу", "small"], ["болонка", "small"],
  ["шитцу", "small"], ["ши тцу", "small"], ["шицу", "small"],
  ["бишон фризе", "small"], ["бишон", "small"], ["котон де tulear", "small"], ["котон", "small"],
  ["папилон", "small"], ["папийон", "small"], ["фален", "small"],
  ["китайска хохлата", "small"], ["мопс", "small"], ["пекинес", "small"],
  ["руски тои", "small"], ["руски той", "small"],
  ["карликовы пинчер", "small"], ["цвергпинчер", "small"], ["мини доберман", "small"],
  ["джек рассел терер", "small"], ["джек рассел", "small"], ["парсон рассел", "small"],
  ["мини такса", "small"], ["такса", "small"], ["дакель", "small"],
  ["вест хайленд уайт", "small"], ["вест хайленд", "small"], ["уайт терер", "small"],
  ["скотч терер", "small"], ["скотчтерер", "small"],
  ["французски булдог", "small"], ["французский бульдог", "small"], ["фр булдог", "small"],
  ["карликовы пудел", "small"], ["тои пудел", "small"], ["мини пудел", "small"], ["пудель той", "small"],
  ["австралийски шелки терер", "small"], ["шелки терер", "small"], ["силки терер", "small"],
  ["норвич терер", "small"], ["норфолк терер", "small"], ["кэрн терер", "small"],
  ["японски хин", "small"], ["хин", "small"],
  ["кавалер кинг чарльз", "small"], ["кавалер", "small"], ["кинг чарльз", "small"],
  ["цвергшнауцер", "small"], ["мини шнауцер", "small"], ["карликовы шнауцер", "small"],
  ["миниатюрны бультерьер", "small"],
  ["фокстерьер", "small"], ["фокс терер", "small"], ["той фокстерьер", "small"],
  ["аляскински кли кай", "small"], ["кли кай", "small"], ["помски", "small"],
  ["левхен", "small"], ["малая львица", "small"], ["пуми", "small"], ["кеесхонд", "small"],

  // --- средние (10–25 кг) ---
  ["бигл", "medium"], ["бигли", "medium"],
  ["английски кокер спаниел", "medium"], ["английскии кокер спаниел", "medium"],
  ["американски кокер", "medium"], ["спрингер спаниел", "medium"], ["спрингер", "medium"],
  ["кокер", "medium"], ["спаниел", "medium"],
  ["бордер колли", "medium"], ["бордерколли", "medium"], ["борд kolli", "medium"],
  ["бордин колли", "medium"], ["колли бордер", "medium"],
  ["австралийска овчарка", "medium"], ["австралийская овчарка", "medium"],
  ["аусси", "medium"], ["ауси", "medium"],
  ["шарпей", "small"], ["шарапей", "small"], ["шар пей", "small"], ["шар-пей", "small"],
  ["бультерьер", "medium"], ["бул терер", "medium"],
  ["стандартны пудел", "medium"], ["пудел", "medium"], ["пудель", "medium"],
  ["английски булдог", "medium"], ["английский бульдог", "medium"],
  ["британски бульдог", "medium"], ["англ бульдог", "medium"],
  ["сиба ину", "medium"], ["шиба ину", "medium"], ["шиба", "medium"],
  ["шелти", "medium"], ["шетландска овчарка", "medium"], ["шетландская овчарка", "medium"],
  ["сибирски хаски", "medium"], ["сибирскии хаски", "medium"], ["хаски", "medium"],
  ["хаська", "medium"], ["хаска", "medium"], ["хаськи", "medium"], ["хаскии", "medium"], ["лайка", "medium"],
  ["вельш корги пемброк", "medium"], ["вельш корги кардиган", "medium"],
  ["вельш корги", "medium"], ["корги", "medium"], ["пемброк", "medium"],
  ["кардиган", "medium"], ["коржи", "medium"],
  ["бассенджи", "annual"],
  ["далматин", "medium"], ["долматин", "medium"], ["далматинец", "medium"], ["долматинец", "medium"],
  ["американски питбул терер", "medium"], ["питбул терер", "medium"],
  ["стаффордширски бультерьер", "medium"], ["питбул", "medium"], ["питбуль", "medium"],
  ["пит буль", "medium"], ["стаффорд", "medium"], ["стафф", "medium"], ["булли", "medium"],
  ["курцхаар", "medium"], ["дратхаар", "medium"], ["немецка жесткошерстна", "medium"],
  ["бретонски эпаньоль", "medium"], ["эпаньоль бретон", "medium"],
  ["миттельшнауцер", "medium"], ["шнауцер", "medium"],
  ["уипет", "medium"], ["уиппет", "medium"],
  ["самоедска лайка", "medium"], ["самоедска", "medium"], ["самоедская", "medium"],
  ["самойед", "medium"], ["самоед", "medium"],
  ["эрдельтерьер", "medium"], ["эрдельтерер", "medium"], ["эрдель", "medium"],
  ["лабрадудл", "medium"], ["лабрадудел", "medium"],
  ["голдендудл", "medium"], ["голдендудел", "medium"],
  ["пикардийска овчарка", "medium"], ["босерон", "large"],
  ["ка де бестиар", "medium"], ["майоркска овчарка", "medium"],
  ["норвежски элкхунд", "medium"], ["элкхунд", "medium"], ["норвежски лундехунд", "medium"],
  ["ентлебухер", "medium"], ["пули", "medium"],
  ["амстафф", "large"], ["американски стаффордширски", "large"], ["стаффордширски терер", "large"],

  // --- крупные (25–45 кг) ---
  ["королевски пудел", "large"],
  ["немецка овчарка", "large"], ["немецкая овчарка", "large"], ["немецкаa овчарка", "large"],
  ["нем овчарка", "large"], ["нем. овчарка", "large"], ["овчарка", "large"],
  ["восточноевропейска овчарка", "giant"], ["восточно европейска овчарка", "giant"],
  ["восточно европейская овчарка", "giant"],
  ["шотландска овчарка", "large"], ["шотландски колли", "large"], ["колли", "large"],
  ["бельгийска овчарка", "large"], ["бельгийская овчарка", "large"], ["малинуа", "large"],
  ["грюнендаль", "large"], ["тервюрен", "large"], ["лакенуа", "large"],
  ["боксер", "large"], ["боксеp", "large"],
  ["лабрадор ретривер", "large"], ["лабрадор-ретривер", "large"],
  ["золотистый ретривер", "large"], ["голден ретривер", "large"], ["голдэн ретривер", "large"],
  ["голден-ретривер", "large"], ["чесапик бей ретривер", "large"],
  ["лабрадор", "large"], ["лабрик", "large"], ["лабрадорка", "large"], ["лабик", "large"],
  ["лабадор", "large"], ["лабрадуры", "large"], ["лапрадор", "large"], ["ратривер", "large"],
  ["ретривер", "large"], ["голден", "large"],
  ["доберман пинчер", "large"], ["доберман", "large"], ["дедерман", "large"],
  ["добик", "large"], ["добер", "large"],
  ["грейхаунд", "large"], ["борзая", "large"],
  ["английски сеттер", "large"], ["ирландски сеттер", "large"], ["гордон сеттер", "large"],
  ["сеттер", "large"], ["пойнтер", "large"],
  ["ротвейлер", "large"], ["роттвейлер", "large"], ["ротвейл", "large"],
  ["ротвелер", "large"], ["ртвейлер", "large"], ["ротви", "large"], ["рот", "large"],
  ["кане корсо", "large"], ["канне корсо", "large"], ["корсо", "large"],
  ["риджбек", "large"], ["родезийски риджбек", "large"],
  ["афганска борзая", "large"], ["афган", "large"],
  ["бобтейл", "large"], ["староанглийска овчарка", "large"],
  ["аляскински маламут", "large"], ["маламут", "large"],
  ["бриар", "large"],
  ["бернски зенненхунд", "large"], ["бернскии зенненхунд", "large"],
  ["бернский зенненхунд", "large"], ["бернская горная", "large"],
  ["барнский зенненхунд", "large"], ["зенненхунд", "large"], ["швейцарски зенненхунд", "large"],
  ["апенцелер зенненхунд", "large"],
  ["акита ину", "large"], ["акита", "large"],
  ["южнорусска овчарка", "large"], ["южнорусская овчарка", "large"],
  ["шарпланинец", "large"], ["сарпланинац", "large"], ["комондор", "large"],
  ["гренландска собака", "large"], ["гренландская собака", "large"],
  ["буви", "large"], ["буверье фландр", "large"], ["фландрски буви", "large"],
  ["бувье фландер", "large"], ["бувье де фландр", "large"],
  ["оттерхаунд", "large"], ["англ foxhound", "large"],

  // --- гиганты (45+ кг) ---
  ["американска акита", "giant"], ["акита американская", "giant"], ["акита большая", "giant"],
  ["алабаи", "giant"], ["алабай", "giant"], ["алобай", "giant"],
  ["среднеазиатска овчарка", "giant"], ["среднеазиатская овчарка", "giant"],
  ["среднеазиат", "giant"], ["волкодав", "giant"],
  ["кавказска овчарка", "giant"], ["кавказская овчарка", "giant"],
  ["кавказка овчарка", "giant"], ["кавказска", "giant"], ["кавказская", "giant"],
  ["сенбернар", "giant"], ["санбернар", "giant"], ["сен бернар", "giant"], ["альпийски мастиф", "giant"],
  ["ньюфаундленд", "giant"], ["ньюф", "giant"], ["нюфаундленд", "giant"],
  ["ньюфундленд", "giant"], ["водолаз", "giant"],
  ["тибетски мастиф", "giant"], ["мастиф", "giant"], ["мастино неаполетано", "giant"],
  ["неаполитански мастиф", "giant"], ["мастино наполетано", "giant"],
  ["немецки дог", "giant"], ["немецкии дог", "giant"], ["нем. дог", "giant"], ["дог", "giant"],
  ["ирландски волкодав", "giant"], ["ирландский волкодав", "giant"],
  ["леонбергер", "giant"], ["леонберге", "giant"],
  ["бурбул", "giant"], ["бурбуль", "giant"], ["боербоель", "giant"],
  ["бульмастиф", "giant"], ["бульмастифф", "giant"],
  ["фила бразилейро", "giant"], ["фила", "giant"],
  ["аргентински дог", "giant"], ["дога аргентино", "giant"], ["дог аргентино", "giant"],
  ["аргентински мастиф", "giant"],
  ["московска сторожевая", "giant"], ["московская сторожевая", "giant"],
  ["черны терьер", "giant"], ["черный терьер", "giant"], ["руски черны терьер", "giant"],
  ["рчт", "giant"],
  ["русска псовая борзая", "giant"], ["русская псовая борзая", "giant"], ["русская борзая", "giant"],
  ["мастиф испанский", "giant"], ["пиренейски мастиф", "giant"],
  ["пиренейская горная", "giant"], ["пиренейски", "giant"],
  ["кангал", "giant"], ["анатолийска овчарка", "giant"], ["анатолийская овчарка", "giant"],
  ["карабаш", "giant"], ["тоса ину", "giant"], ["гросс", "giant"], ["риезеншнауцер", "giant"],

  // --- дворняги / неизвестное ---
  ["дворняжка", "unknown"], ["дворняга", "unknown"], ["дворняч", "unknown"],
  ["метис", "unknown"], ["метиски", "unknown"], ["помесь", "unknown"],
  ["беспородна", "unknown"], ["беспородны", "unknown"], ["микс", "unknown"],
  ["mixed", "unknown"], ["полукровка", "unknown"], ["mongrel", "unknown"],
  ["неизвестна", "unknown"], ["неизвестно", "unknown"], ["не знаю", "unknown"],
  ["без породы", "unknown"], ["нет породы", "unknown"], ["породы нет", "unknown"],
  ["просто пес", "unknown"], ["просто собака", "unknown"], ["обычна собака", "unknown"],
];

// «мини/микро/той» в строке сгибает класс к small, если порода распознана.
// \b в JS не работает с кириллицей — проверяем вхождение как отдельного слова вручную.
const MINI_WORDS = ["мини", "микро", "той", "карликовы", "карликовый", "тои"];
function hasMiniWord(n: string): boolean {
  return n.split(" ").some(w => MINI_WORDS.includes(w));
}
export function sizeClassByBreed(breed: string | null | undefined): SizeClass | null {
  if (!breed?.trim()) return null;
  const n = normalizeBreed(breed);
  if (!n) return null;
  const cls = lookup(n);
  if (!cls) return null;
  if (cls !== "unknown" && hasMiniWord(n)) return "small";
  return cls;
}

// «Германская/восточноевропейская овчарка», малинуа, доберман: по ветсправочникам
// склонны к частым циклам (интервал 4,5–5 мес) — интервал 135+ дн для них не тревога.
// Матчится по нормализованному имени породы (см. normalizeBreed).
const FREQUENT_INTERVAL_KEYS = ["овчарка", "малинуа", "доберман"];
export function isFrequentIntervalBreed(breed: string | null | undefined): boolean {
  if (!breed?.trim()) return false;
  const n = normalizeBreed(breed);
  return FREQUENT_INTERVAL_KEYS.some(k => n.includes(k));
}

// итоговый профиль собаки: порода распознана → её класс; иначе класс по весу;
// иначе unknown (глобальные дефолты как до волны 5).
export function resolveBreedProfile(breed: string | null | undefined, weightGrams: number | null | undefined): BreedProfile {
  const byBreed = sizeClassByBreed(breed);
  if (byBreed) return SIZE_PROFILES[byBreed];
  const byWeight = sizeClassByWeight(weightGrams);
  return SIZE_PROFILES[byWeight ?? "unknown"];
}

function lookup(n: string): SizeClass | null {
  for (const [k, cls] of BREED_MAP) {
    if (n.includes(k)) return cls;
  }
  return null;
}
