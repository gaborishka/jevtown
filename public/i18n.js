// Every word of the interface, in Ukrainian and in English. The Worker reads it too, for the page
// head a messenger shows. Persona attributes (interests, jobs, cities) carry their own labels in
// shared/vocab.js; what Jev is asked is always English and lives in shared/presets.js.

const number = (locale) => (value) => Math.round(value).toLocaleString(locale);
const plural = (n, [one, few, many]) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
/** How many people a town has: the 10,000 and whoever visitors moved in. */
const residentsUk = (people) => `${number('uk')(people)} ${plural(people, ['мешканець', 'мешканці', 'мешканців'])}`;
const residentsEn = (people) => `${number('en')(people)} residents`;

const uk = {
  lang: 'uk',
  langName: 'Українська',
  brand: 'Jevtown',
  n: number('uk'),
  and: (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} і ${items.at(-1)}` : items[0]),
  title: 'Соцмережа, де пишуть люди, а читають 10 000 ШІ-персон',
  lead: 'Напишіть пост, оголошення, товар чи заголовок. За кілька секунд місто відреагує: більшість проскролить, хтось лайкне, зарепостить, заблокує, напише продавцю або купить.',
  headLine: (post) => `У місті побачили ${number('uk')(post.reach)} · зупинилися ${number('uk')(post.stopped)} · раді ${number('uk')(post.glad)} · незадоволені ${number('uk')(post.sorry)}. Кожну реакцію дала модель Jev.`,
  hero: { eyebrow: 'Зайде?', title: ['Тут пишуть люди,', 'а читають 10\u00a0000 ШІ-персон.'], write: 'Написати пост', demo: 'Як це працює' },
  show: {
    kicker: 'Збережений приклад · українські мешканці', title: 'Одне оголошення про iPhone, написане двома способами',
    variants: ['З деталями й оглядом', 'Тільки передоплата'], map: 'Кожна точка це одна персона з 10 000',
    loading: 'Завантажуємо приклад…', unavailable: 'Приклад не завантажився. Свій текст можна запостити нижче.',
    findings: [
      (c) => [`${number('uk')(c.byReaction.wrote)} ${plural(c.byReaction.wrote, ['персона написала', 'персони написали', 'персон написали'])} продавцю.`, `Оголошення пішло у другу хвилю й дісталося ${number('uk')(c.reach)} персон.`],
      (c) => ['Кожна третя персона запідозрила обман.', `Оголошення зупинилось після першої хвилі. Обман запідозрили ${number('uk')(c.byReaction.scam)} із ${number('uk')(c.reach)}.`],
    ],
  },
  verdict: {
    label: 'Підсумок',
    everyone: 'Зайшло всьому місту', stopped: (wave) => `Не зайшло далі ${['першої', 'другої', 'третьої'][wave] ?? `${wave + 1}-ї`} хвилі`,
    reached: (reach, people) => `Текст побачили ${number('uk')(reach)} із ${number('uk')(people)} ${plural(people, ['мешканця', 'мешканців', 'мешканців'])}.`,
    balance: (glad, sorry) => `Раді: ${number('uk')(glad)}. Незадоволені: ${number('uk')(sorry)}.`,
    why: 'Текст іде далі, коли радих у хвилі більше, ніж незадоволених, щонайменше на 10% хвилі.',
    // What the town said when asked (shared/presets.js:ASKS): the answer given most often, the two or three about equal at the top, or none.
    asked: {
      passed: { one: (answer) => `Найчастіша причина проскролити: ${answer}.`, equal: (list) => `Ті, хто проскролив, приблизно однаково часто називали: ${list}.`, none: 'Серед тих, хто проскролив, жодна причина не виділяється.' },
      annoyed: { one: (answer) => `Найчастіша причина роздратування: ${answer}.`, equal: (list) => `Ті, кого роздратувало, приблизно однаково часто називали: ${list}.`, none: 'Серед тих, кого роздратувало, жодна причина не виділяється.' },
      hook: { one: (answer) => `Що найчастіше зупиняло тих, кому сподобалось: ${answer}.`, equal: (list) => `Що зупиняло тих, кому сподобалось, приблизно однаково часто: ${list}.`, none: 'Серед того, що зупиняло тих, кому сподобалось, нічого не виділяється.' },
    },
  },
  compare: { title: 'Порівняти тексти версій', previous: 'Попередня версія', current: 'Ця версія' },
  presets: {
    post: { name: 'Пост', hint: 'Пост для Telegram, X чи будь-якої стрічки', promise: 'побачите, хто лайкне, зарепостить або заблокує', placeholder: 'Місяць писав код тільки з ШІ-асистентом і порахував…' },
    listing: { name: 'Оголошення', hint: 'Оголошення про продаж, як на OLX', promise: 'побачите, хто напише продавцю і що спитає', placeholder: 'iPhone 13, 128 ГБ, синій. Акумулятор 86%, не ремонтувався. 14 000 грн, Львів…' },
    product: { name: 'Товар', hint: 'Товар або послуга з цінами', promise: 'побачите, хто купить і за скільки', placeholder: 'Шкарпетки з мериносової вовни для бігу, які не пахнуть після тижня тренувань…' },
    headline: { name: 'Заголовок', hint: 'Заголовок статті, листа чи лендингу', promise: 'побачите, хто клікне, а кого він роздратує', placeholder: 'Я замінив ранкову рутину однією звичкою на 4 хвилини. Ось що змінилося за місяць' },
  },
  mapKeys: 'Стрілки вибирають людину, Enter відкриває її сторінку',
  nav: { feed: 'Стрічка', crowd: 'Місто', me: 'Мешканець', write: 'Написати', back: 'Назад', about: 'Кожну реакцію дає Jev, модель, яка відповідає ймовірностями й не пише тексту.' },
  compose: {
    // The crowd is picked by the language of the text, so there is nothing to switch.
    readers: { uk: (people) => `Читатиме українське місто, ${residentsUk(people)}`, en: (people) => `Читатиме англомовне місто, ${residentsUk(people)}` },
    nickname: 'Ваше ім’я або нік', anonymous: 'анонім', listed: 'У спільну стрічку', unlisted: 'Лише за посиланням',
    text: 'Текст', kind: 'Що ви пишете', prices: 'Ціни', currency: 'Валюта',
    ladder: {
      title: ['Ціни в', '· назвіть кілька'],
      note: 'Кожного, хто зупиниться на товарі, спитаємо, за яку найбільшу з цих цін він купить. Побачите, скільки покупців дає кожна ціна і яка з них заробляє найбільше.',
      add: 'ще ціна', remove: 'Прибрати ціну', price: (index) => `Ціна ${index}`,
    },
    go: 'Запостити', busy: 'Місто читає…', again: 'Запостити нову версію', cancel: 'Скасувати', edit: 'Редагувати',
  },
  feed: { order: 'Порядок стрічки', latest: 'Нові', top: 'Найдалі зайшли', empty: 'Тут поки порожньо. Ваш текст буде першим.', totals: (posts, reach) => `${number('uk')(posts)} ${plural(posts, ['текст', 'тексти', 'текстів'])} · ${number('uk')(reach)} показів персонам`, versions: (count) => `${count} ${plural(count, ['версія', 'версії', 'версій'])}` },
  ago: (ms) => {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'щойно';
    if (minutes < 60) return `${minutes} хв`;
    if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} год`;
    if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))} дн`;
    return new Date(Date.now() - ms).toLocaleDateString('uk', { day: 'numeric', month: 'short' });
  },
  rail: { title: 'Місто', size: residentsUk, waiting: 'Чекають на ваш текст', waitingNote: 'Ніхто в місті ще нічого не бачив. Спершу текст побачать 600 людей, яким він найближчий.', voices: 'Голоси міста' },
  voices: { title: 'Голоси міста', note: 'Випадкові люди з тих, хто відреагував. Натисніть на людину, щоб відкрити її сторінку.', noteSaid: 'Випадкові люди з тих, хто відреагував, і кілька тих, хто проскролив, із відповіддю, яку Jev дав за кожного. Натисніть на людину, щоб відкрити її сторінку.', more: 'Показати ще', count: (shown, all) => `${number('uk')(shown)} з ${number('uk')(all)}`, nobody: 'Тут поки нікого.', wouldAsk: ['спитали б', 'спитав би', 'спитала б'], details: 'питає про деталь, якої немає в тексті', nothing: 'бере без питань' },
  ladder: { none: 'не купить за жодну з цих цін', upTo: (cost) => `купить лише за ${cost} або дешевше`, at: (cost) => `купить за ${cost}, не дорожче`, even: (cost) => `купить навіть за ${cost}` },
  post: { back: 'Стрічка', replay: 'Показати ще раз', everyone: 'усі', asking: { listing: 'питання', product: 'ціни' }, filter: 'Натисніть на реакцію, щоб побачити цих людей на карті', picture: (totals) => `Карта міста, точка на кожного мешканця. Побачили ${number('uk')(totals.reach)}, зупинилися ${number('uk')(totals.stopped)}, раді ${number('uk')(totals.glad)}, незадоволені ${number('uk')(totals.sorry)}.` },
  crowd: {
    title: 'Місто', lead: '10 000 постійних мешканців і ті, кого заселили відвідувачі. Кожен має ім’я, роботу, захоплення, характер і гаманець. Сусіди на карті схожі: згори молодші, знизу старші, а кожне захоплення має свій район. Нові мешканці селяться під містом.',
    lenses: { interest: 'Захоплення', field: 'Робота', age: 'Вік', temper: 'Характер', budget: 'Гроші' },
    everyone: 'Усі', count: (count, everyone) => (everyone ? 'з усього міста' : `${number('uk')(count)} у цій групі`), people: 'Кілька з них', hint: 'Наведіть на точку, щоб побачити людину. Натисніть, щоб відкрити її сторінку.',
  },
  looks: { dark: 'не побачили', scrolled: 'проскролили', stopped: 'зупинилися', glad: 'раді', spreads: 'понесли далі', sorry: 'незадоволені', hollow: 'невідомо' },
  counters: { reach: 'побачили', stopped: 'зупинилися', glad: 'раді', sorry: 'незадоволені' },
  reactions: {
    scrolled_past: ['проскролили', 'проскролив', 'проскролила'], read: ['прочитали', 'прочитав', 'прочитала'], liked: ['лайкнули', 'лайкнув', 'лайкнула'],
    disliked: ['дизлайкнули', 'дизлайкнув', 'дизлайкнула'], reposted: ['зарепостили', 'зарепостив', 'зарепостила'], followed: ['підписалися', 'підписався', 'підписалася'],
    blocked: ['заблокували', 'заблокував', 'заблокувала'], cant_tell: ['невідомо', 'невідомо', 'невідомо'],
    opened: ['відкрили', 'відкрив', 'відкрила'], saved: ['зберегли', 'зберіг', 'зберегла'], wrote: ['написали продавцю', 'написав продавцю', 'написала продавцю'],
    scam: ['запідозрили обман', 'запідозрив обман', 'запідозрила обман'],
    looked: ['подивилися', 'подивився', 'подивилася'], cart: ['додали в кошик', 'додав у кошик', 'додала в кошик'], bought: ['купили', 'купив', 'купила'],
    glanced: ['зачепило, без кліку', 'зачепило, без кліку', 'зачепило, без кліку'], clicked: ['клікнули', 'клікнув', 'клікнула'], annoyed: ['роздратувалися', 'роздратувався', 'роздратувалася'],
  },
  run: {
    scoring: 'Jev вирішує, кому це показати…',
    wave: (index, total) => `Хвиля ${index + 1} · разом ${number('uk')(total)} ${plural(total, ['людина', 'людини', 'людей'])}`,
    went: 'пішло далі', stayed: 'зупинилось', moodNote: (mood) => `Настрій хвилі ${mood}: частка радих мінус частка незадоволених. Далі текст іде від +0.10.`,
    followup: (people) => `Розпитуємо тих, хто зупинився: ${number('uk')(people)}`,
    asking: 'Ставимо кільком із тих, хто побачив, ще кілька питань…',
    travels: 'місту зайшло, іде далі', stops: 'далі не пішло',
    watching: 'Місто саме читає цей текст…', failed: 'Сталася помилка, місто не дочитало. Оновіть сторінку, щоб продовжити.', stale: 'Місто не дочитало цей текст. Нижче реакції тих, хто встиг.',
    done: (waves, seconds, usd) => `${waves} ${plural(waves, ['хвиля', 'хвилі', 'хвиль'])} · ${seconds.toFixed(0)} с · $${usd.toFixed(3)}`,
  },
  blocks: {
    shownNote: 'За кого алгоритм стрічки прийняв цей текст. Оцінки Jev від 0 до 1.',
    tabs: { stopped: 'Зупинилися', glad: 'Сподобалось', sorry: 'Роздратувало', shown: 'Кому показали' },
    titles: { stopped: 'Хто зупинився', glad: 'Кому сподобалось', sorry: 'Кого роздратувало', shown: 'Кому показали' },
    segmentNote: (what, share) => `Групи, де це зачепило найбільшу частку людей. Серед усього міста ${what}: ${share}.`,
    alike: 'Текст зайшов усім приблизно однаково, жодна група не виділилась. Ось найбільші з них.',
    bestPrice: (cost, buyers, revenue) => `Найбільше заробляє ${cost}: ${number('uk')(buyers)} ${plural(buyers, ['покупець', 'покупці', 'покупців'])}, виторг ${revenue}.`,
    nobody: 'Ніхто не виділився.',
    questions: 'Що спитають покупці', questionsNote: (asked) => `Перше питання до продавця від ${number('uk')(asked)} тих, хто зупинився.`,
    demand: 'Скільки готові заплатити', demandNote: (asked) => `Найвища ціна, за яку купили б ${number('uk')(asked)} тих, хто зупинився.`,
    buyers: 'покупців', revenue: 'виторг', best: 'найбільший виторг',
    versionDelta: 'проти попередньої версії',
    unlisted: 'Цей текст не потрапив у спільну стрічку, сторінка доступна лише за посиланням.',
    hiddenByAuthor: 'Автор не показує це у спільній стрічці.',
    annoyedGroup: (group, sorry, reached) => `Найчастіше роздратувалися в групі «${group}»: ${number('uk')(sorry)} з ${number('uk')(reached)} тих, хто побачив.`,
  },
  said: {
    tabs: { scrolled: 'Чому пройшли повз', sorry: 'Чому роздратувало', hook: 'Що зупинило', comment: 'Коментували б' },
    titles: { scrolled: 'Чому проскролили', sorry: 'Чому роздратувалися', hook: 'Що зупинило тих, кому сподобалось', comment: 'Що написали б у коментарях' },
    // Each is followed by `order`.
    notes: {
      scrolled: (asked) => `Спитали ${number('uk')(asked)} з тих, хто проскролив`, sorry: (asked) => `Спитали ${number('uk')(asked)} з тих, кого роздратувало`, hook: (asked) => `Спитали ${number('uk')(asked)} з тих, кому сподобалось`,
      comment: (asked) => `Спитали ${number('uk')(asked)} з тих, хто зупинився`,
    },
    order: ', у порядку, в якому стрічка показувала їм текст, тож здебільшого тих, для кого цей текст.',
    commentNote: '«Не коментує» теж відповідь, а частки порахано серед тих, про кого Jev щось зміг сказати.',
    point: 'Наведіть на відповідь, щоб побачити цих людей на карті.',
    lead: 'Виділено відповідь, яку давали найчастіше, або дві чи три майже рівні нагорі.',
    flat: 'Жодна відповідь не виділяється: нагорі більше трьох майже рівних.',
    drain: (share) => `Для ${share} опитаних ніщо в людині не підказувало відповіді. На смугах їх немає.`,
    split: (text, readers) => `${text} цих відповідей про сам текст, ${readers} про те, хто читав.`,
    labels: {
      why: { not_for_them: 'не цікаво й не потрібно', weak_opening: 'початок не чіпляє', unclear: 'незрозуміло, що це', too_long: 'задовго читати', nothing_new: 'нічого нового', distrust: 'не викликає довіри', tone: 'відштовхує тон', disagree: 'не збігається з поглядами', price: 'задорого', missing: 'бракує важливого' },
      hook: {
        example: 'конкретна цифра чи приклад', story: 'особиста історія', useful: 'корисна порада', humour: 'гумор', opinion: 'згода з думкою автора', opening: 'перше речення', topic: 'сама тема',
        price: 'ціна', details: 'деталі', trust: 'довіра до продавця', terms: 'умови угоди', need: 'просто потрібна річ',
        benefit: 'розв’язує їхню проблему', claims: 'переконливі обіцянки', guarantee: 'гарантія чи легке повернення',
        curiosity: 'цікавість', promise: 'обіцянка', detail: 'конкретна цифра чи деталь', news: 'звучить як новина',
      },
      comment: { adds_own: 'погоджується й додає свій досвід', question: 'питає автора', argues: 'сперечається чи вказує на помилку', thanks: 'дякує чи хвалить кількома словами', joke: 'жартує', tags: 'позначає друга', none: 'не коментує' },
    },
  },
  checks: {
    title: 'Як Jev читає сам текст',
    note: 'Це відповіді Jev про сам текст, а не реакції міста. На те, хто його побачить, вони не впливають.',
    labels: {
      point_first: { listing: 'Перше речення каже, що продається' },
      ask: { post: 'Зрозуміло, чого автор хоче від читача', listing: 'Сказано, як відбудеться угода', product: 'Сказано, що робити далі' },
      concrete: 'Є конкретна цифра, назва чи приклад',
    },
    values: { yes: 'так', no: 'ні', unclear: 'неясно' },
  },
  segments: { interest: (label) => `цікавляться: ${label}`, field: (label) => label, age: (label) => `${label} років`, temper: (label) => label, budget: (label) => label, shopping: (label) => `шукають: ${label}`, city: (label) => label },
  fields: { it: 'айтівці', creative: 'творчі професії', education: 'освітяни', medicine: 'медики', trades: 'майстри й будівельники', retail: 'продаж і сервіс', office: 'офісні працівники', finance: 'фінансисти', business: 'бізнес і продажі', public: 'держслужба й силовики', agriculture: 'фермери', transport: 'водії й кур’єри', home: 'у декреті', student: 'студенти', retired: 'пенсіонери' },
  tempers: { lurker: 'мовчуни', skeptic: 'скептики', supporter: 'добрі душі', enthusiast: 'ентузіасти', bargain_hunter: 'мисливці за знижками', trend_chaser: 'ловці трендів', nitpicker: 'прискіпи', troll: 'тролі' },
  answers: {
    available: 'Ще актуально?', negotiable: 'Торг можливий?', quick_discount: 'Поступитеся, якщо заберу сьогодні?', condition: 'Який стан, є подряпини?', defects: 'Усе працює, був у ремонті?',
    how_old: 'Скільки йому років, як багато користувалися?', why_selling: 'Чому продаєте?', original: 'Це оригінал?', documents: 'Є чек, коробка, документи чи гарантія?', included: 'Що в комплекті?',
    details: 'Технічна деталь, якої немає в тексті (акумулятор, пробіг, розмір, матеріал)', photos: 'Можна ще фото або відео?', delivery: 'Відправляєте? Хто платить за доставку?', pickup: 'Де й коли можна забрати?',
    try_first: 'Можна перевірити перед оплатою?', safe_deal: 'Можна через безпечну угоду або накладеним платежем?', exchange: 'Обмін розглядаєте?', hold: 'Притримаєте на кілька днів?', bulk: 'Є ще такі? Яка ціна за кілька?', nothing: 'Нічого не питають, одразу беруть',
  },
  persona: { lives: 'Живе тут', history: 'Що робить зі свіжими текстами', noHistory: 'Свіжі тексти сюди не дійшли.', shopping: 'Шукає', nothing: 'нічого не шукає', neighbours: 'Підсвічені ті, хто має те саме головне захоплення. Сусіди на карті схожі: той самий вік і ті самі інтереси.', newStreet: 'Підсвічені ті, хто має те саме головне захоплення. Нові мешканці селяться під містом у порядку приїзду, тож сусіди тут бувають різні.', since: (date) => `У місті з ${date}`, write: 'Написати пост', next: 'Сусіди', years: (age) => `${age} ${plural(age, ['рік', 'роки', 'років'])}` },
  blocked: {
    text: (reasons) => `Не запощено${reasons.length ? `: у тексті ${reasons.join(', ')}` : ''}. Перепишіть і спробуйте ще раз.`,
    reasons: { hate: 'ворожнеча до людей', sexual: 'відвертий сексуальний зміст', violence: 'погрози', private_data: 'чужі особисті дані', illegal: 'продаж забороненого', insult: 'образи', gibberish: 'набір символів без змісту' },
  },
  me: {
    eyebrow: 'Новий мешканець', editEyebrow: 'Ваш мешканець', title: 'Заселіть мешканця в Jevtown',
    lead: 'Вигадайте людину, і вона оселиться в місті поруч із 10\u00a0000 інших. Вона читатиме нові пости й реагуватиме на них, як усі тут, а відповідатиме за неї Jev. Вона може бути схожа на вас, а може бути ким завгодно.',
    form: {
      name: 'Ім’я', gender: 'Хто це', genders: { female: 'вона', male: 'він' }, age: 'Вік', job: 'Чим займається', city: 'Місто',
      interests: 'Захоплення', interestsNote: 'Оберіть до трьох. Перше стане головним і визначить район на мапі.', main: 'головне', chosen: 'Обрано', drop: 'Прибрати',
      temper: 'Як поводиться у стрічці', budget: 'Гроші',
      about: 'Своїми словами', aboutNote: 'це прочитає лише Jev', aboutHint: 'Що чіпляє цю людину в стрічці, а що дратує. Наприклад: «Не терплю капсу й історій успіху, зате читаю все про собак».',
      shown: 'Ім’я, вік, заняття, місто й захоплення побачать усі в місті. Це вигаданий персонаж, тож справжніх прізвищ, адрес і телефонів не вписуйте.',
      create: 'Заселити', save: 'Зберегти', cancel: 'Скасувати',
    },
    years: (age) => `${age} ${plural(age, ['рік', 'роки', 'років'])}`,
    edit: 'Змінити', editTitle: 'Змінити мешканця', page: 'Сторінка в місті',
    moved: (date) => `У місті з ${date}. Читає нові пости разом з усіма.`,
    hello: { title: (name) => `${name} тепер у Jevtown`, note: (number) => `Будинок № ${number}. Нові пости доходитимуть сюди, як до всіх у місті.` },
    feed: 'Що робить зі свіжими постами',
    tune: {
      step: 'Крок 1', title: 'Покажіть, як ваш мешканець поводиться у стрічці',
      note: (cards) => `${cards} постів. Про кожен скажіть, що з ним зробить ваш мешканець. Якщо він схожий на вас, відповідайте за себе. Jev запам’ятає відповіді й звірятиметься з ними щоразу, коли відповідає за нього, і в стрічці теж.`,
      start: 'Почати', more: 'Ще коло', kept: (n) => `Jev пам’ятає ${n} ${plural(n, ['реакцію', 'реакції', 'реакцій'])}`,
    },
    test: {
      step: 'Крок 2', title: 'Чи відповість Jev так само, як ви?',
      note: (cards) => `${cards} нових постів. Спершу відповідаєте ви, потім Jev. Ваших відповідей на ці пости він не бачить.`,
      start: 'Спробувати', again: 'Ще спроба', locked: 'Спершу пройдіть крок 1.', busy: 'Jev відповідає за мешканця…', retry: 'Спробувати ще раз',
    },
    over: (cards) => `Ви відповіли на всі ${cards} постів.`,
    quiz: { ask: 'Що ваш мешканець зробить із цим постом?', progress: (index, total) => `${index} із ${total}`, back: 'Попередній пост', leave: 'Вийти' },
    // What the resident does with a post; Jev's guess is shown in the same words.
    do: { scrolled_past: 'Проскролить', read: 'Прочитає', liked: 'Лайкне', disliked: 'Дизлайкне', reposted: 'Зарепостить', followed: 'Підпишеться', blocked: 'Заблокує' },
    result: {
      title: 'Остання спроба', withAnswers: 'відповідей Jev збіглися з вашими', byDescription: 'збіглося б лише за описом, без кроку 1',
      rounds: 'Усі спроби', round: (index) => `Спроба ${index}`, of: (hit, asked) => `${hit} із ${asked}`, plainShort: (hit) => `за описом ${hit}`,
    },
    answers: { title: 'Що Jev знає про мешканця', note: 'Усі ваші відповіді. Коли Jev відповідає за мешканця, він бере шість найближчих до поста.', empty: 'Поки що лише опис.', you: 'Ви сказали', guessed: 'Jev сказав те саме', missed: (word) => `Jev сказав: «${word}»` },
    lives: 'Місце на карті', pick: 'Оберіть захоплення, і побачите його район.',
    nearest: 'Схожий мешканець міста',
    reset: 'Забути реакції', resetSure: 'Jev забуде всі реакції та спроби цього мешканця. Продовжити?',
    remove: 'Виселити мешканця', removeSure: 'Опис і всі реакції буде стерто, а в будинку оселиться хтось інший із міста. Продовжити?',
    errors: {
      bad_profile: 'Потрібні ім’я, вік, «вона» чи «він», хоча б одне захоплення і те, як мешканець поводиться у стрічці.',
      blocked: (reasons) => `Мешканця не заселено${reasons.length ? `: в описі ${reasons.join(', ')}` : ''}. Перепишіть і спробуйте ще раз.`,
      full: 'У місті поки немає вільних будинків.',
      limit: 'На сьогодні досить. Спробуйте завтра.', jev: 'Jev зараз не відповідає. Нічого не загубилося, спробуйте ще раз.',
    },
  },
  card: { open: 'Картка поста', saw: (people) => `із ${number('uk')(people)} ${plural(people, ['мешканця', 'мешканців', 'мешканців'])} побачили`, share: 'Поділитися', download: 'Зберегти PNG', close: 'Закрити' },
  share: 'Скопіювати посилання', copied: 'Скопійовано', version: 'версія',
  errors: { limit: 'На сьогодні ліміт постів вичерпано. Приходьте завтра або запустіть свою копію з власним ключем.', empty: 'Напишіть текст, хоч один рядок.', bad_text: 'Текст має бути від 1 до 2000 символів.', bad_prices: 'Виправте позначені ціни: потрібні щонайменше дві різні, числами.', no_key: 'На сервері не задано ключ Jev.', not_yours: 'Нову версію може запостити лише автор, із того самого браузера.', bad_request: 'Запит не зрозуміло. Оновіть сторінку і спробуйте ще раз.', busy: 'Місто ще читає попередню версію. Зачекайте, поки дочитає.', not_found: 'Такої сторінки немає.', error: 'Щось пішло не так. Спробуйте ще раз.' },
};

const en = {
  lang: 'en',
  langName: 'English',
  brand: 'Jevtown',
  n: number('en'),
  and: (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0]),
  title: 'A social network where people write and 10,000 AI personas read',
  lead: 'Post a text, a listing, a product or a headline. Within seconds the town reacts: most scroll past, some like, repost, block, write to the seller or buy.',
  headLine: (post) => `Seen by ${number('en')(post.reach)} in town · ${number('en')(post.stopped)} stopped · ${number('en')(post.glad)} glad · ${number('en')(post.sorry)} sorry. Every reaction comes from Jev.`,
  hero: { eyebrow: 'Will it land?', title: ['Here people write', 'and 10,000 AI personas read.'], write: 'Write a post', demo: 'See how it works' },
  show: {
    kicker: 'A saved example · the Ukrainian residents', title: 'One iPhone listing, written two ways',
    variants: ['Details, pay on inspection', 'Advance payment only'], map: 'Every dot is one persona out of 10,000',
    loading: 'Loading the example…', unavailable: 'The example did not load. You can post your own text below.',
    findings: [
      (c) => [`${number('en')(c.byReaction.wrote)} personas wrote to the seller.`, `The listing went into a second wave and reached ${number('en')(c.reach)} personas.`],
      (c) => ['One persona in three smelled a scam.', `The listing stopped after the first wave. ${number('en')(c.byReaction.scam)} of ${number('en')(c.reach)} smelled a scam.`],
    ],
  },
  verdict: {
    label: 'The result',
    everyone: 'It landed with the whole town', stopped: (wave) => `It did not get past the ${['first', 'second', 'third'][wave] ?? `${wave + 1}th`} wave`,
    reached: (reach, people) => `${number('en')(reach)} of ${number('en')(people)} residents saw it.`,
    balance: (glad, sorry) => `Glad: ${number('en')(glad)}. Sorry: ${number('en')(sorry)}.`,
    why: 'A text travels on when the glad outnumber the sorry by at least 10% of the wave.',
    // What the town said when asked (shared/presets.js:ASKS): the answer given most often, the two or three about equal at the top, or none.
    asked: {
      passed: { one: (answer) => `The reason given most often for scrolling past: ${answer}.`, equal: (list) => `Those who scrolled past gave these reasons about equally often: ${list}.`, none: 'No single reason stands out among those who scrolled past.' },
      annoyed: { one: (answer) => `The reason given most often for getting annoyed: ${answer}.`, equal: (list) => `Those who got annoyed gave these reasons about equally often: ${list}.`, none: 'No single reason stands out among those who got annoyed.' },
      hook: { one: (answer) => `What most often stopped the people who liked it: ${answer}.`, equal: (list) => `What stopped the people who liked it, about equally often: ${list}.`, none: 'Nothing stands out in what stopped the people who liked it.' },
    },
  },
  compare: { title: 'Compare the texts', previous: 'Previous version', current: 'This version' },
  presets: {
    post: { name: 'Post', hint: 'A post for Telegram, X or any feed', promise: 'you will see who likes, reposts or blocks it', placeholder: 'I wrote code with an AI assistant only for a month and counted…' },
    listing: { name: 'Listing', hint: 'A for-sale listing, as on Craigslist', promise: 'you will see who writes to the seller and what they ask', placeholder: 'iPhone 13, 128 GB, blue. Battery 86%, never repaired. $320, Austin…' },
    product: { name: 'Product', hint: 'A product or a service with its prices', promise: 'you will see who buys it and at what price', placeholder: 'Merino wool running socks that do not smell after a week of training…' },
    headline: { name: 'Headline', hint: 'The headline of an article, an email or a landing page', promise: 'you will see who clicks and whom it annoys', placeholder: 'I replaced my morning routine with one 4-minute habit. Here is what changed in 30 days' },
  },
  mapKeys: 'Arrows pick a person, Enter opens their page',
  nav: { feed: 'Feed', crowd: 'The town', me: 'Resident', write: 'Write', back: 'Back', about: 'Every reaction comes from Jev, a model that answers with probabilities and writes no text.' },
  compose: {
    readers: { uk: (people) => `The Ukrainian town will read it, ${residentsEn(people)}`, en: (people) => `The English-speaking town will read it, ${residentsEn(people)}` },
    nickname: 'Your name or nickname', anonymous: 'anonymous', listed: 'To the public feed', unlisted: 'By link only',
    text: 'Text', kind: 'What you are writing', prices: 'Prices', currency: 'Currency',
    ladder: {
      title: ['Prices in', '· name a few'],
      note: 'Everyone who stops at the product is asked for the highest of these prices they would pay. You will see how many buyers each price gets and which one earns the most.',
      add: 'another price', remove: 'Remove the price', price: (index) => `Price ${index}`,
    },
    go: 'Post', busy: 'The town is reading…', again: 'Post the new version', cancel: 'Cancel', edit: 'Edit',
  },
  feed: { order: 'Order of the feed', latest: 'Latest', top: 'Travelled furthest', empty: 'Nothing here yet. Your text will be the first.', totals: (posts, reach) => `${number('en')(posts)} text${posts === 1 ? '' : 's'} · seen ${number('en')(reach)} times`, versions: (count) => `${count} versions` },
  ago: (ms) => {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
    if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))}d`;
    return new Date(Date.now() - ms).toLocaleDateString('en', { day: 'numeric', month: 'short' });
  },
  rail: { title: 'The town', size: residentsEn, waiting: 'Waiting for your text', waitingNote: 'Nobody in town has seen anything yet. A text is first shown to the 600 people it is closest to.', voices: 'Voices of the town' },
  voices: { title: 'Voices of the town', note: 'Random people out of those who reacted. Click a person to open their page.', noteSaid: 'Random people out of those who reacted, and some who scrolled past, with an answer Jev gave for each. Click a person to open their page.', more: 'Show more', count: (shown, all) => `${number('en')(shown)} of ${number('en')(all)}`, nobody: 'Nobody here yet.', wouldAsk: ['would ask', 'would ask', 'would ask'], details: 'asks about a detail the listing leaves out', nothing: 'takes it, no questions' },
  ladder: { none: 'would not buy at any of these prices', upTo: (cost) => `would buy only at ${cost} or less`, at: (cost) => `would buy at ${cost}, not above`, even: (cost) => `would buy even at ${cost}` },
  post: { back: 'Feed', replay: 'Replay', everyone: 'all', asking: { listing: 'questions', product: 'prices' }, filter: 'Click a reaction to see these people on the map', picture: (totals) => `A map of the town, a dot for every resident. ${number('en')(totals.reach)} saw it, ${number('en')(totals.stopped)} stopped, ${number('en')(totals.glad)} are glad, ${number('en')(totals.sorry)} are sorry.` },
  crowd: {
    title: 'The town', lead: '10,000 permanent residents and the people visitors moved in. Each has a name, a job, interests, a temper and a wallet. Neighbours on the map are alike: younger at the top, older at the bottom, and every interest has a district of its own. New residents settle under the town.',
    lenses: { interest: 'Interests', field: 'Work', age: 'Age', temper: 'Temper', budget: 'Money' },
    everyone: 'Everybody', count: (count, everyone) => (everyone ? 'out of the whole town' : `${number('en')(count)} in this group`), people: 'A few of them', hint: 'Hover a dot to see the person. Click to open their page.',
  },
  looks: { dark: 'not shown', scrolled: 'scrolled past', stopped: 'stopped', glad: 'glad', spreads: 'spread it', sorry: 'sorry', hollow: "can't tell" },
  counters: { reach: 'saw it', stopped: 'stopped', glad: 'glad', sorry: 'sorry' },
  reactions: Object.fromEntries(Object.entries({
    scrolled_past: 'scrolled past', read: 'read it', liked: 'liked it', disliked: 'disliked it', reposted: 'reposted it', followed: 'followed', blocked: 'blocked', cant_tell: "can't tell",
    opened: 'opened it', saved: 'saved it', wrote: 'wrote to the seller', scam: 'smelled a scam', looked: 'looked', cart: 'added to cart', bought: 'bought it',
    glanced: 'hooked, no click', clicked: 'clicked', annoyed: 'felt baited',
  }).map(([id, label]) => [id, [label, label, label]])),
  run: {
    scoring: 'Jev is deciding whom to show it to…',
    wave: (index, total) => `Wave ${index + 1} · ${number('en')(total)} people in total`,
    went: 'travelled on', stayed: 'stopped here', moodNote: (mood) => `Mood of the wave ${mood}: the share who were glad minus the share who were sorry. A text travels on from +0.10.`,
    followup: (people) => `Asking the ${number('en')(people)} who stopped`,
    asking: 'Asking some of those who saw it a few more questions…',
    travels: 'it landed, it travels further', stops: 'it stops here',
    watching: 'The town is reading this right now…', failed: 'Something failed and the town did not finish reading. Reload the page to go on.', stale: 'The town did not finish reading this text. Below are the reactions of those who did.',
    done: (waves, seconds, usd) => `${waves} wave${waves === 1 ? '' : 's'} · ${seconds.toFixed(0)} s · $${usd.toFixed(3)}`,
  },
  blocks: {
    shownNote: 'Whom the feed algorithm took this text for. Scores from Jev, 0 to 1.',
    tabs: { stopped: 'Stopped', glad: 'Liked it', sorry: 'Got annoyed', shown: 'Shown to' },
    titles: { stopped: 'Who stopped', glad: 'Who liked it', sorry: 'Who got annoyed', shown: 'Whom it was shown to' },
    segmentNote: (what, share) => `The groups where it caught the largest share of people. Across the whole town, ${what}: ${share}.`,
    alike: 'It worked on everybody about alike, no group stood out. Here are the biggest ones.',
    bestPrice: (cost, buyers, revenue) => `${cost} earns the most: ${number('en')(buyers)} buyer${buyers === 1 ? '' : 's'}, revenue ${revenue}.`,
    nobody: 'Nobody stood out.',
    questions: 'What buyers would ask', questionsNote: (asked) => `The first question to the seller from the ${number('en')(asked)} who stopped.`,
    demand: 'What they would pay', demandNote: (asked) => `The highest price the ${number('en')(asked)} who stopped would buy at.`,
    buyers: 'buyers', revenue: 'revenue', best: 'earns the most',
    versionDelta: 'against the previous version',
    unlisted: 'This text did not make it to the public feed; the page works by link only.',
    hiddenByAuthor: 'The author keeps this out of the public feed.',
    annoyedGroup: (group, sorry, reached) => `The group most often annoyed among those who saw it: “${group}”, ${number('en')(sorry)} of ${number('en')(reached)}.`,
  },
  said: {
    tabs: { scrolled: 'Why they passed', sorry: 'Why annoyed', hook: 'What stopped them', comment: 'Would comment' },
    titles: { scrolled: 'Why they scrolled past', sorry: 'Why they got annoyed', hook: 'What stopped the people who liked it', comment: 'What they would write in the comments' },
    // Each is followed by `order`.
    notes: {
      scrolled: (asked) => `Asked of ${number('en')(asked)} people who scrolled past`, sorry: (asked) => `Asked of ${number('en')(asked)} people who got annoyed`, hook: (asked) => `Asked of ${number('en')(asked)} people who liked it`,
      comment: (asked) => `Asked of ${number('en')(asked)} people who stopped`,
    },
    order: ', in the order the feed showed them the text, so mostly those it was meant for.',
    commentNote: 'Not commenting is one of the answers, and the shares are among the people Jev could place.',
    point: 'Point at an answer to see these people on the map.',
    lead: 'Highlighted: the answer given most often, or the two or three at the top that are about equal.',
    flat: 'No answer stands out: more than three are about equal at the top.',
    drain: (share) => `For ${share} of those asked, nothing about the person hinted at an answer. The bars leave them out.`,
    split: (text, readers) => `${text} of these answers are about the text itself, ${readers} about who was reading it.`,
    labels: {
      why: { not_for_them: 'not for them', weak_opening: 'the opening does not hook', unclear: 'unclear what it is', too_long: 'too long to take in', nothing_new: 'nothing new', distrust: 'hard to believe', tone: 'off-putting tone', disagree: 'at odds with their views', price: 'too expensive', missing: 'something important is missing' },
      hook: {
        example: 'a concrete number or example', story: 'a personal story', useful: 'a tip they can use', humour: 'humour', opinion: 'an opinion they share', opening: 'the first sentence', topic: 'the topic itself',
        price: 'the price', details: 'the details', trust: 'trust in the seller', terms: 'the terms of the deal', need: 'simply needing it',
        benefit: 'it solves their problem', claims: 'believable claims', guarantee: 'a guarantee or an easy return',
        curiosity: 'curiosity', promise: 'the promise', detail: 'a concrete number or detail', news: 'it sounds new or important',
      },
      comment: { adds_own: 'agrees and adds their own experience', question: 'asks the author a question', argues: 'argues or points out a mistake', thanks: 'thanks or praises in a few words', joke: 'jokes', tags: 'tags a friend', none: 'would not comment' },
    },
  },
  checks: {
    title: 'How Jev reads the text',
    note: 'Jev’s answers about the text itself, not the town’s reactions. They do not change who sees it.',
    labels: {
      point_first: { listing: 'The first sentence says what is for sale' },
      ask: { post: 'Clear what readers should do', listing: 'Says how the deal is done', product: 'Says what to do next' },
      concrete: 'Has a concrete number, name or example',
    },
    values: { yes: 'yes', no: 'no', unclear: 'unclear' },
  },
  segments: { interest: (label) => `into ${label}`, field: (label) => label, age: (label) => `aged ${label}`, temper: (label) => label, budget: (label) => label, shopping: (label) => `looking for ${label}`, city: (label) => label },
  fields: { it: 'IT people', creative: 'creatives', education: 'teachers', medicine: 'medics', trades: 'tradespeople', retail: 'retail and service', office: 'office workers', finance: 'finance people', business: 'business and sales', public: 'public servants', agriculture: 'farmers', transport: 'drivers and couriers', home: 'stay-at-home parents', student: 'students', retired: 'pensioners' },
  tempers: { lurker: 'lurkers', skeptic: 'skeptics', supporter: 'supporters', enthusiast: 'enthusiasts', bargain_hunter: 'bargain hunters', trend_chaser: 'trend chasers', nitpicker: 'nitpickers', troll: 'trolls' },
  answers: null, // English answers are the ones Jev reads, from shared/presets.js
  persona: { lives: 'Lives here', history: 'What they do with fresh texts', noHistory: 'Fresh texts did not reach them.', shopping: 'Looking for', nothing: 'not looking for anything', neighbours: 'Lit up are the people with the same main interest. Neighbours on the map are alike: the same age and the same interests.', newStreet: 'Lit up are the people with the same main interest. New residents settle under the town in the order they came, so neighbours here can be anybody.', since: (date) => `In town since ${date}`, write: 'Write a post', next: 'Neighbours', years: (age) => `${age} years old` },
  blocked: {
    text: (reasons) => `Not posted${reasons.length ? `: the text has ${reasons.join(', ')}` : ''}. Rewrite it and try again.`,
    reasons: { hate: 'hatred of people', sexual: 'explicit sexual content', violence: 'threats', private_data: "somebody's private data", illegal: 'an offer of something illegal', insult: 'insults', gibberish: 'no meaning, only characters' },
  },
  me: {
    eyebrow: 'A new resident', editEyebrow: 'Your resident', title: 'Move a resident into Jevtown',
    lead: 'Make up a person, and they settle in town next to the other 10,000. They will read new posts and react to them like everybody here, and Jev will answer for them. They may be a lot like you, or anybody at all.',
    form: {
      name: 'Name', gender: 'Who is it', genders: { female: 'she', male: 'he' }, age: 'Age', job: 'What they do', city: 'City',
      interests: 'Interests', interestsNote: 'Pick up to three. The first becomes the main one and decides the district on the map.', main: 'main', chosen: 'Chosen', drop: 'Remove',
      temper: 'How they behave in a feed', budget: 'Money',
      about: 'In their own words', aboutNote: 'only Jev reads this', aboutHint: 'What hooks this person in a feed and what annoys them. For example: “I can’t stand all caps and success stories, but I read anything about dogs.”',
      shown: 'Everybody in town sees the name, the age, the job, the city and the interests. This is a made-up character, so leave out real surnames, addresses and phone numbers.',
      create: 'Move in', save: 'Save', cancel: 'Cancel',
    },
    years: (age) => `${age} years old`,
    edit: 'Change', editTitle: 'Change the resident', page: 'Their page in town',
    moved: (date) => `In town since ${date}. Reads new posts along with everybody.`,
    hello: { title: (name) => `${name} lives in Jevtown now`, note: (number) => `House No. ${number}. New posts will come here the way they come to everybody in town.` },
    feed: 'What they do with fresh posts',
    tune: {
      step: 'Step 1', title: 'Show how your resident behaves in a feed',
      note: (cards) => `${cards} posts. Say what your resident does with each. If they are like you, answer for yourself. Jev keeps the answers and goes by them whenever it answers for the resident, in the feed too.`,
      start: 'Start', more: 'Another round', kept: (n) => `Jev remembers ${n} ${n === 1 ? 'reaction' : 'reactions'}`,
    },
    test: {
      step: 'Step 2', title: 'Will Jev answer the way you do?',
      note: (cards) => `${cards} new posts. You answer first, then Jev. It does not see your answers to these posts.`,
      start: 'Try it', again: 'Another try', locked: 'Do step 1 first.', busy: 'Jev is answering for the resident…', retry: 'Try again',
    },
    over: (cards) => `You have answered all ${cards} posts.`,
    quiz: { ask: 'What does your resident do with this post?', progress: (index, total) => `${index} of ${total}`, back: 'Previous post', leave: 'Leave' },
    do: { scrolled_past: 'Scrolls past', read: 'Reads it', liked: 'Likes it', disliked: 'Dislikes it', reposted: 'Reposts it', followed: 'Follows', blocked: 'Blocks' },
    result: {
      title: 'The latest try', withAnswers: 'of Jev’s answers matched yours', byDescription: 'would have matched from the description alone, without step 1',
      rounds: 'Every try', round: (index) => `Try ${index}`, of: (hit, asked) => `${hit} of ${asked}`, plainShort: (hit) => `description alone ${hit}`,
    },
    answers: { title: 'What Jev knows about the resident', note: 'All your answers. When Jev answers for the resident, it takes the six nearest to the post.', empty: 'Only the description so far.', you: 'You said', guessed: 'Jev said the same', missed: (word) => `Jev said: “${word}”` },
    lives: 'Their place on the map', pick: 'Pick an interest to see its district.',
    nearest: 'A resident much like them',
    reset: 'Forget the reactions', resetSure: 'Jev will forget all reactions and tries of this resident. Go on?',
    remove: 'Move the resident out', removeSure: 'The description and all reactions will be wiped, and somebody else from town will live in the house. Go on?',
    errors: {
      bad_profile: 'A name, an age, “she” or “he”, at least one interest and how the resident behaves in a feed are needed.',
      blocked: (reasons) => `The resident has not moved in${reasons.length ? `: the description has ${reasons.join(', ')}` : ''}. Rewrite it and try again.`,
      full: 'There are no free houses in town for now.',
      limit: 'That is enough for today. Try again tomorrow.', jev: 'Jev is not answering right now. Nothing is lost, try again.',
    },
  },
  card: { open: 'Post card', saw: (people) => `of ${number('en')(people)} residents saw it`, share: 'Share', download: 'Save the PNG', close: 'Close' },
  share: 'Copy the link', copied: 'Copied', version: 'version',
  errors: { limit: 'The daily limit of posts is used up. Come back tomorrow, or run your own copy with your own key.', empty: 'Write something first, a line is enough.', bad_text: 'The text must be 1 to 2000 characters.', bad_prices: 'Fix the marked prices: at least two different ones, as numbers.', no_key: 'No Jev key is set on the server.', not_yours: 'Only the author, from the same browser, can post a new version.', bad_request: 'The request was not understood. Reload the page and try again.', busy: 'The previous version is still running. Wait until it finishes.', not_found: 'There is no such page.', error: 'Something went wrong. Try again.' },
};

export const DICTIONARIES = { uk, en };
