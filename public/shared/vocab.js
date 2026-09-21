// Fixed vocabularies a persona is built from. Jev reads the English label, the interface shows
// the label of its language. Ids are stable: stored reactions and links depend on them.

/**
 * Interests, laid out as the persona grid sees them: 5 rows of 8, youngest row first. A persona's
 * main interest is the nearest cell, so people with the same interest and age sit next to each other.
 * `field` is the job field such people often work in, `shopping` what they are often looking to buy.
 */
export const INTEREST_COLUMNS = 8;
export const INTERESTS = [
  // 18–27
  { id: 'games', en: 'video games', uk: 'відеоігри', shopping: 'console' },
  { id: 'anime', en: 'anime', uk: 'аніме', shopping: 'books' },
  { id: 'memes', en: 'memes and internet culture', uk: 'меми та інтернет-культура' },
  { id: 'pop_music', en: 'pop music', uk: 'попмузика', shopping: 'gift' },
  { id: 'fashion', en: 'fashion', uk: 'мода', field: 'retail', shopping: 'clothes' },
  { id: 'beauty', en: 'beauty and skincare', uk: 'краса та догляд', field: 'retail', shopping: 'beauty' },
  { id: 'student_life', en: 'student life', uk: 'студентське життя', shopping: 'laptop' },
  { id: 'crypto', en: 'crypto', uk: 'криптовалюти', field: 'finance' },
  // 24–36
  { id: 'programming', en: 'programming', uk: 'програмування', field: 'it', shopping: 'laptop' },
  { id: 'ai_tools', en: 'AI tools', uk: 'ШІ-інструменти', field: 'it', shopping: 'courses' },
  { id: 'startups', en: 'startups', uk: 'стартапи', field: 'business' },
  { id: 'design', en: 'design', uk: 'дизайн', field: 'creative', shopping: 'laptop' },
  { id: 'photography', en: 'photography', uk: 'фотографія', field: 'creative', shopping: 'phone' },
  { id: 'travel', en: 'travel', uk: 'подорожі', shopping: 'trip' },
  { id: 'fitness', en: 'gym and fitness', uk: 'спортзал і фітнес', shopping: 'sports_gear' },
  { id: 'cycling', en: 'running and cycling', uk: 'біг і велосипед', shopping: 'bicycle' },
  // 33–46
  { id: 'parenting', en: 'parenting', uk: 'виховання дітей', field: 'home', shopping: 'kids' },
  { id: 'renovation', en: 'home renovation', uk: 'ремонт житла', field: 'trades', shopping: 'tools' },
  { id: 'cooking', en: 'cooking', uk: 'кулінарія', shopping: 'appliances' },
  { id: 'cars', en: 'cars', uk: 'автомобілі', field: 'transport', shopping: 'car' },
  { id: 'investing', en: 'investing', uk: 'інвестиції', field: 'finance' },
  { id: 'personal_finance', en: 'personal finance', uk: 'особисті фінанси', field: 'finance' },
  { id: 'career', en: 'career growth', uk: 'кар’єра', field: 'office', shopping: 'courses' },
  { id: 'psychology', en: 'psychology', uk: 'психологія', field: 'medicine', shopping: 'books' },
  // 43–58
  { id: 'politics', en: 'news and politics', uk: 'новини та політика', field: 'public' },
  { id: 'small_business', en: 'small business', uk: 'малий бізнес', field: 'business' },
  { id: 'real_estate', en: 'real estate', uk: 'нерухомість', field: 'business', shopping: 'rent' },
  { id: 'football', en: 'football', uk: 'футбол', shopping: 'sports_gear' },
  { id: 'fishing', en: 'fishing', uk: 'рибалка', field: 'trades', shopping: 'sports_gear' },
  { id: 'history', en: 'history', uk: 'історія', field: 'education', shopping: 'books' },
  { id: 'books', en: 'books', uk: 'книжки', field: 'education', shopping: 'books' },
  { id: 'tv_series', en: 'movies and TV series', uk: 'фільми та серіали' },
  // 52–80
  { id: 'gardening', en: 'gardening', uk: 'садівництво', field: 'agriculture', shopping: 'garden' },
  { id: 'summer_house', en: 'their summer house', uk: 'дача', shopping: 'garden' },
  { id: 'health', en: 'health', uk: 'здоров’я', field: 'medicine' },
  { id: 'faith', en: 'faith', uk: 'віра', field: 'public' },
  { id: 'crafts', en: 'knitting and crafts', uk: 'в’язання та рукоділля', shopping: 'gift' },
  { id: 'pets', en: 'pets', uk: 'домашні тварини', shopping: 'pets' },
  { id: 'volunteering', en: 'volunteering', uk: 'волонтерство', field: 'public' },
  { id: 'folk_music', en: 'classical and folk music', uk: 'класична й народна музика', field: 'creative' },
];

/** Job fields. `group` is how the feed algorithm names the people of a field; `income` shifts the budget. */
export const FIELDS = {
  it: { group: 'people who work in IT', income: 1.2 },
  creative: { group: 'designers, photographers, writers and musicians', income: 0.2 },
  education: { group: 'teachers and lecturers', income: -0.3 },
  medicine: { group: 'doctors, nurses and pharmacists', income: 0 },
  trades: { group: 'builders, electricians, mechanics and other tradespeople', income: 0 },
  retail: { group: 'people who work in shops, cafes and salons', income: -0.5 },
  office: { group: 'office workers: accountants, lawyers, HR, bank clerks', income: 0.2 },
  finance: { group: 'people who work in finance', income: 0.8 },
  business: { group: 'business owners, sales and marketing people', income: 0.8 },
  public: { group: 'civil servants, police, soldiers and social workers', income: -0.2 },
  agriculture: { group: 'farmers', income: -0.2 },
  transport: { group: 'drivers and couriers', income: -0.3 },
  home: { group: 'stay-at-home parents', income: -0.4 },
  student: { group: 'students', income: -1 },
  retired: { group: 'pensioners', income: -1 },
};

export const JOBS = [
  { id: 'developer', field: 'it', en: 'software developer', uk: 'розробник' },
  { id: 'qa', field: 'it', en: 'QA engineer', uk: 'тестувальник' },
  { id: 'product_manager', field: 'it', en: 'product manager', uk: 'продакт-менеджер' },
  { id: 'data_analyst', field: 'it', en: 'data analyst', uk: 'аналітик даних' },
  { id: 'designer', field: 'creative', en: 'designer', uk: 'дизайнер' },
  { id: 'photographer', field: 'creative', en: 'photographer', uk: 'фотограф' },
  { id: 'copywriter', field: 'creative', en: 'copywriter', uk: 'копірайтер' },
  { id: 'musician', field: 'creative', en: 'musician', uk: 'музикант' },
  { id: 'teacher', field: 'education', en: 'school teacher', uk: 'шкільний учитель' },
  { id: 'lecturer', field: 'education', en: 'university lecturer', uk: 'викладач університету' },
  { id: 'tutor', field: 'education', en: 'tutor', uk: 'репетитор' },
  { id: 'doctor', field: 'medicine', en: 'doctor', uk: 'лікар' },
  { id: 'nurse', field: 'medicine', en: 'nurse', uk: 'медсестра' },
  { id: 'pharmacist', field: 'medicine', en: 'pharmacist', uk: 'фармацевт' },
  { id: 'electrician', field: 'trades', en: 'electrician', uk: 'електрик' },
  { id: 'builder', field: 'trades', en: 'builder', uk: 'будівельник' },
  { id: 'mechanic', field: 'trades', en: 'car mechanic', uk: 'автомеханік' },
  { id: 'welder', field: 'trades', en: 'welder', uk: 'зварювальник' },
  { id: 'shop_assistant', field: 'retail', en: 'shop assistant', uk: 'продавець' },
  { id: 'barista', field: 'retail', en: 'barista', uk: 'бариста' },
  { id: 'hairdresser', field: 'retail', en: 'hairdresser', uk: 'перукар' },
  { id: 'accountant', field: 'office', en: 'accountant', uk: 'бухгалтер' },
  { id: 'lawyer', field: 'office', en: 'lawyer', uk: 'юрист' },
  { id: 'hr', field: 'office', en: 'HR manager', uk: 'HR-менеджер' },
  { id: 'bank_clerk', field: 'finance', en: 'bank clerk', uk: 'працівник банку' },
  { id: 'financial_analyst', field: 'finance', en: 'financial analyst', uk: 'фінансовий аналітик' },
  { id: 'business_owner', field: 'business', en: 'small business owner', uk: 'власник малого бізнесу' },
  { id: 'sales_manager', field: 'business', en: 'sales manager', uk: 'менеджер з продажу' },
  { id: 'marketer', field: 'business', en: 'marketer', uk: 'маркетолог' },
  { id: 'realtor', field: 'business', en: 'real estate agent', uk: 'рієлтор' },
  { id: 'civil_servant', field: 'public', en: 'civil servant', uk: 'держслужбовець' },
  { id: 'police', field: 'public', en: 'police officer', uk: 'поліцейський' },
  { id: 'soldier', field: 'public', en: 'soldier', uk: 'військовий' },
  { id: 'social_worker', field: 'public', en: 'social worker', uk: 'соціальний працівник' },
  { id: 'farmer', field: 'agriculture', en: 'farmer', uk: 'фермер' },
  { id: 'truck_driver', field: 'transport', en: 'truck driver', uk: 'далекобійник' },
  { id: 'taxi_driver', field: 'transport', en: 'taxi driver', uk: 'таксист' },
  { id: 'courier', field: 'transport', en: 'courier', uk: 'кур’єр' },
  { id: 'home_parent', field: 'home', en: 'stay-at-home parent', uk: 'у декреті' },
  { id: 'student', field: 'student', en: 'student', uk: 'студент' },
  { id: 'retired', field: 'retired', en: 'pensioner', uk: 'пенсіонер' },
];

export const AGE_GROUPS = [
  { id: 'a18', from: 18, group: 'people aged 18 to 24', en: '18–24', uk: '18–24' },
  { id: 'a25', from: 25, group: 'people aged 25 to 34', en: '25–34', uk: '25–34' },
  { id: 'a35', from: 35, group: 'people aged 35 to 44', en: '35–44', uk: '35–44' },
  { id: 'a45', from: 45, group: 'people aged 45 to 59', en: '45–59', uk: '45–59' },
  { id: 'a60', from: 60, group: 'people aged 60 and older', en: '60+', uk: '60+' },
];

/** How a persona behaves in a feed. `line` is what Jev reads. */
export const TEMPERS = [
  { id: 'lurker', weight: 30, line: 'quiet lurker, rarely reacts', en: 'lurker', uk: 'мовчун' },
  { id: 'skeptic', weight: 18, line: 'skeptical, distrusts ads and big claims', en: 'skeptic', uk: 'скептик' },
  { id: 'supporter', weight: 12, line: 'supportive, encourages people', en: 'supporter', uk: 'добра душа' },
  { id: 'enthusiast', weight: 12, line: 'enthusiastic, likes and shares easily', en: 'enthusiast', uk: 'ентузіаст' },
  { id: 'bargain_hunter', weight: 10, line: 'bargain hunter, always compares prices', en: 'bargain hunter', uk: 'мисливець за знижками' },
  { id: 'trend_chaser', weight: 8, line: 'chases trends, follows whatever is new', en: 'trend chaser', uk: 'ловець трендів' },
  { id: 'nitpicker', weight: 6, line: 'nitpicker, spots every mistake', en: 'nitpicker', uk: 'прискіпа' },
  { id: 'troll', weight: 4, line: 'troll, enjoys picking fights', en: 'troll', uk: 'троль' },
];

export const BUDGETS = [
  { id: 'tight', level: -1, line: 'tight budget', group: 'people on a tight budget', en: 'tight budget', uk: 'рахує кожну гривню' },
  { id: 'average', level: 0, line: 'average income', group: 'people with an average income', en: 'average income', uk: 'середній дохід' },
  { id: 'comfortable', level: 1, line: 'comfortable income', group: 'people with a comfortable income', en: 'comfortable income', uk: 'добрий дохід' },
  { id: 'wealthy', level: 2, line: 'wealthy', group: 'wealthy people', en: 'wealthy', uk: 'великі статки' },
];

/** `line` is empty for the middle value: most people are neither, and the persona line stays shorter. */
export const SPENDING = [
  { id: 'careful', weight: 40, line: 'careful with money', en: 'careful with money', uk: 'обережно витрачає' },
  { id: 'neutral', weight: 40, line: '', en: '', uk: '' },
  { id: 'impulsive', weight: 20, line: 'buys on impulse', en: 'buys on impulse', uk: 'купує імпульсивно' },
];

/** What a persona is looking to buy right now; only the Listing and Product presets show it to Jev. */
export const SHOPPING = [
  { id: 'nothing', en: 'nothing in particular', uk: 'нічого конкретного' },
  { id: 'phone', en: 'a phone', uk: 'телефон' },
  { id: 'laptop', en: 'a laptop', uk: 'ноутбук' },
  { id: 'car', en: 'a car', uk: 'авто' },
  { id: 'rent', en: 'an apartment to rent', uk: 'квартиру в оренду' },
  { id: 'furniture', en: 'furniture', uk: 'меблі' },
  { id: 'kids', en: "kids' things", uk: 'дитячі речі' },
  { id: 'clothes', en: 'clothes and shoes', uk: 'одяг і взуття' },
  { id: 'bicycle', en: 'a bicycle', uk: 'велосипед' },
  { id: 'appliances', en: 'home appliances', uk: 'побутову техніку' },
  { id: 'garden', en: 'plants and garden tools', uk: 'рослини й садовий інвентар' },
  { id: 'sports_gear', en: 'sports gear', uk: 'спортивне спорядження' },
  { id: 'gift', en: 'a gift', uk: 'подарунок' },
  { id: 'books', en: 'books', uk: 'книжки' },
  { id: 'console', en: 'a game console', uk: 'ігрову приставку' },
  { id: 'beauty', en: 'beauty products', uk: 'косметику' },
  { id: 'pets', en: 'pet supplies', uk: 'товари для тварин' },
  { id: 'tools', en: 'tools', uk: 'інструменти' },
  { id: 'courses', en: 'an online course', uk: 'онлайн-курс' },
  { id: 'trip', en: 'a vacation trip', uk: 'відпустку' },
];

/** Names run from the ones young people carry to the ones their grandparents carry. */
export const POOLS = {
  uk: {
    female: [
      ['Solomiia', 'Соломія'], ['Daryna', 'Дарина'], ['Sofia', 'Софія'], ['Alina', 'Аліна'], ['Anastasia', 'Анастасія'], ['Viktoria', 'Вікторія'],
      ['Khrystyna', 'Христина'], ['Yulia', 'Юлія'], ['Kateryna', 'Катерина'], ['Anna', 'Анна'], ['Maria', 'Марія'], ['Iryna', 'Ірина'],
      ['Oksana', 'Оксана'], ['Olena', 'Олена'], ['Natalia', 'Наталія'], ['Tetiana', 'Тетяна'], ['Svitlana', 'Світлана'], ['Olha', 'Ольга'],
      ['Larysa', 'Лариса'], ['Nadiia', 'Надія'], ['Liudmyla', 'Людмила'], ['Halyna', 'Галина'], ['Valentyna', 'Валентина'], ['Hanna', 'Ганна'],
    ],
    male: [
      ['Nazar', 'Назар'], ['Artem', 'Артем'], ['Denys', 'Денис'], ['Maksym', 'Максим'], ['Bohdan', 'Богдан'], ['Yaroslav', 'Ярослав'],
      ['Dmytro', 'Дмитро'], ['Roman', 'Роман'], ['Taras', 'Тарас'], ['Andrii', 'Андрій'], ['Oleksandr', 'Олександр'], ['Pavlo', 'Павло'],
      ['Serhii', 'Сергій'], ['Oleh', 'Олег'], ['Ihor', 'Ігор'], ['Yurii', 'Юрій'], ['Volodymyr', 'Володимир'], ['Mykhailo', 'Михайло'],
      ['Viktor', 'Віктор'], ['Ivan', 'Іван'], ['Mykola', 'Микола'], ['Petro', 'Петро'], ['Vasyl', 'Василь'], ['Stepan', 'Степан'],
    ],
    cities: [
      ['Kyiv', 'Київ', 20], ['Kharkiv', 'Харків', 9], ['Odesa', 'Одеса', 8], ['Dnipro', 'Дніпро', 8], ['Lviv', 'Львів', 8],
      ['Zaporizhzhia', 'Запоріжжя', 5], ['Vinnytsia', 'Вінниця', 4], ['Poltava', 'Полтава', 3], ['Chernihiv', 'Чернігів', 3], ['Cherkasy', 'Черкаси', 3],
      ['Ivano-Frankivsk', 'Івано-Франківськ', 3], ['Ternopil', 'Тернопіль', 3], ['Lutsk', 'Луцьк', 3], ['Rivne', 'Рівне', 3], ['Uzhhorod', 'Ужгород', 2],
      ['Chernivtsi', 'Чернівці', 3], ['Zhytomyr', 'Житомир', 3], ['Sumy', 'Суми', 3], ['Mykolaiv', 'Миколаїв', 4], ['Khmelnytskyi', 'Хмельницький', 3],
      ['Bila Tserkva', 'Біла Церква', 2], ['a village in Poltava region', 'село на Полтавщині', 3], ['a village in Lviv region', 'село на Львівщині', 3],
    ],
  },
  en: {
    female: [
      ['Mia', 'Мія'], ['Chloe', 'Хлоя'], ['Zoe', 'Зої'], ['Emma', 'Емма'], ['Olivia', 'Олівія'], ['Hannah', 'Ганна'],
      ['Emily', 'Емілі'], ['Ashley', 'Ешлі'], ['Jessica', 'Джессіка'], ['Sarah', 'Сара'], ['Rachel', 'Рейчел'], ['Amanda', 'Аманда'],
      ['Jennifer', 'Дженніфер'], ['Michelle', 'Мішель'], ['Lisa', 'Ліса'], ['Karen', 'Карен'], ['Susan', 'Сьюзен'], ['Deborah', 'Дебора'],
      ['Linda', 'Лінда'], ['Patricia', 'Патриція'], ['Barbara', 'Барбара'], ['Carol', 'Керол'], ['Margaret', 'Маргарет'], ['Dorothy', 'Дороті'],
    ],
    male: [
      ['Liam', 'Ліам'], ['Noah', 'Ноа'], ['Ethan', 'Ітан'], ['Tyler', 'Тайлер'], ['Jake', 'Джейк'], ['Ryan', 'Раян'],
      ['Josh', 'Джош'], ['Daniel', 'Деніел'], ['Matt', 'Метт'], ['Chris', 'Кріс'], ['Andrew', 'Ендрю'], ['Jason', 'Джейсон'],
      ['Brian', 'Браян'], ['Kevin', 'Кевін'], ['Mark', 'Марк'], ['Scott', 'Скотт'], ['David', 'Девід'], ['Michael', 'Майкл'],
      ['Steve', 'Стів'], ['John', 'Джон'], ['Robert', 'Роберт'], ['Richard', 'Річард'], ['Gary', 'Гері'], ['Frank', 'Френк'],
    ],
    cities: [
      ['New York', 'Нью-Йорк', 8], ['Los Angeles', 'Лос-Анджелес', 6], ['Chicago', 'Чикаго', 5], ['Austin', 'Остін', 4], ['Seattle', 'Сіетл', 4],
      ['Denver', 'Денвер', 3], ['Atlanta', 'Атланта', 4], ['Boston', 'Бостон', 3], ['Miami', 'Маямі', 3], ['Portland', 'Портленд', 3],
      ['Nashville', 'Нешвілл', 3], ['Phoenix', 'Фінікс', 3], ['a small town in Ohio', 'містечко в Огайо', 4], ['a small town in Texas', 'містечко в Техасі', 4],
      ['London', 'Лондон', 8], ['Manchester', 'Манчестер', 4], ['Leeds', 'Лідс', 2], ['Bristol', 'Бристоль', 2], ['Glasgow', 'Глазго', 2],
      ['Dublin', 'Дублін', 3], ['Toronto', 'Торонто', 5], ['Vancouver', 'Ванкувер', 3], ['Sydney', 'Сідней', 4], ['Melbourne', 'Мельбурн', 3],
    ],
  },
};

const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]));
export const INTEREST = byId(INTERESTS);
export const JOB = byId(JOBS);
export const AGE_GROUP = byId(AGE_GROUPS);
export const TEMPER = byId(TEMPERS);
export const BUDGET = byId(BUDGETS);
export const SPEND = byId(SPENDING);
export const SHOP = byId(SHOPPING);
