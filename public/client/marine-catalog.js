// Educational species profiles, checked 2026-10-31. Population status is not a
// count of animals; study measurements are explicitly distinguished from maxima.
export const MARINE_SPECIES = [
  {
    id: 'clownfish', name: 'Рыба-клоун', scientificName: 'Amphiprion ocellaris',
    model: '/assets/marine/clownfish.glb', displayLength: .8, count: 3, bottom: false,
    danger: 'Низкая опасность', dangerDetail: 'Для человека безвредна. Наблюдайте, не трогая.',
    rows: [
      ['ГДЕ ЖИВЁТ', 'Индийский и западный Тихий океан. Рифы и лагуны, среди актиний; глубина 1–15 м.'],
      ['РАЗМЕР И МАССА', 'Длина до 11 см. В исследовании: самцы в среднем 3,5 г, самки 9–11 г; это не пределы вида.'],
      ['ПОПУЛЯЦИЯ', 'IUCN: наименьшие опасения (LC). Общая численность в этих источниках не указана.'],
      ['ПИТАНИЕ', 'Зоопланктон, мелкие рачки и нитчатые водоросли.'],
      ['ИНТЕРЕСНЫЙ ФАКТ', 'Живёт в союзе с актинией. Самец охраняет икру; при потере самки крупнейший самец может стать самкой.'],
    ],
    sourceLabel: 'Oregon Coast Aquarium · FishBase · Iwata et al., 2020',
    sources: [
      { title: 'Oregon Coast Aquarium — Ocellaris Clownfish', url: 'https://aquarium.org/animals/ocellaris-clownfish/' },
      { title: 'FishBase — Amphiprion ocellaris', url: 'https://www.fishbase.se/summary/Amphiprion-ocellaris' },
      { title: 'Iwata et al., 2020 — Measurements of breeding pairs, table 2', url: 'https://journal.bdfish.org/index.php/fisheries/article/download/JFish20179/144/' },
    ],
  },
  {
    id: 'lobster', name: 'Американский омар', scientificName: 'Homarus americanus',
    model: '/assets/marine/lobster.glb', displayLength: 1.2, count: 1, bottom: true,
    danger: 'Осторожно: клешни', dangerDetail: 'Сильные клешни могут ущипнуть. Не берите в руки.',
    rows: [
      ['ГДЕ ЖИВЁТ', 'Северо-запад Атлантики. Каменистое дно и укрытия; часто мельче 50 м, встречается глубже 500 м.'],
      ['РАЗМЕР И МАССА', 'Крупные особи достигают 60 см и более 18 кг. Это исключительные размеры, а не средний вес.'],
      ['ПОПУЛЯЦИЯ', 'Оценка 2025: юг Новой Англии сильно истощён; в заливе Мэн / Джорджес-Банк отмечен перелов.'],
      ['ПИТАНИЕ', 'Крабы, моллюски, черви, рыба и водоросли. Всеядный донный обитатель.'],
      ['ИНТЕРЕСНЫЙ ФАКТ', 'Днём прячется, активен ночью. Для роста сбрасывает панцирь; одна клешня дробит, другая разрывает пищу.'],
    ],
    sourceLabel: 'Fisheries and Oceans Canada · NOAA Fisheries',
    sources: [
      { title: 'Fisheries and Oceans Canada — American Lobster', url: 'https://www.dfo-mpo.gc.ca/species-especes/profiles-profils/american-lobster-homard-eng.html' },
      { title: 'NOAA — American Lobster, population assessment 2025', url: 'https://www.fisheries.noaa.gov/species/american-lobster' },
      { title: 'NOAA — Lobster claws and appearance', url: 'https://www.fisheries.noaa.gov/species/american-lobster/recreational' },
    ],
  },
];
