/**
 * @typedef {Object} LibraryItem
 * @property {string} title
 * @property {string} description
 * @property {string} instructor
 * @property {string} category - matches one of the 22 filter tags
 * @property {string} url
 */

/** @type {LibraryItem[]} */
export const libraryItems = [
  {
    title:       "Omens Oracles & Prophecies",
    description: "Oracles & Prophecies provides an overview of divination systems, ranging from ancient Chinese bone burning to modern astrology. The class investigates the systems used to make and record predictions in the past and compares them with the forecasting methods used by scientists today.",
    instructor:  "Alyssa Goodman",
    category:    "Science",
    url:         "https://www.edx.org/learn/social-science/harvard-university-predictionx-omens-oracles-prophecies",
  },
  {
    title:       "Lost Without Longitude",
    description: "Explore the tools and techniques of navigation, with a particular focus on the importance (and difficulty) of measuring longitude.",
    instructor:  "Alyssa Goodman",
    category:    "Science",
    url:         "https://www.edx.org/learn/astronomy/harvard-university-predictionx-lost-without-longitude",
  },
  {
    title:       "John Snow and the Cholera Epidemic of 1854",
    description: "An in-depth look at the 1854 London cholera epidemic in Soho and its importance for the field of epidemiology.",
    instructor:  "Alyssa Goodman",
    category:    "History",
    url:         "https://www.edx.org/learn/history/harvard-university-predictionx-john-snow-and-the-cholera-epidemic-of-1854",
  },
  {
    title:       "Shakespeare and His World",
    description: "Explore the life, works, and times of William Shakespeare, from his birthplace in Stratford-upon-Avon to the London playhouses.",
    instructor:  "Stephen Greenblatt",
    category:    "Story",
    url:         "https://www.edx.org/learn/shakespeare/harvard-university-shakespeare-and-his-world",
  },
  {
    title:       "Rhetoric: The Art of Persuasive Writing and Public Speaking",
    description: "Gain critical communication skills in writing and public speaking with this introduction to American political rhetoric.",
    instructor:  "James Engell",
    category:    "Story",
    url:         "https://www.edx.org/learn/rhetoric/harvard-university-rhetoric-the-art-of-persuasive-writing-and-public-speaking",
  },
  {
    title:       "Building your Screenplay",
    description: "Learn to strengthen your skills as a screenwriter, while diversifying your knowledge and understanding of the demands of global film and TV production.",
    instructor:  "Abigail Docherty",
    category:    "Story",
    url:         "https://www.edx.org/learn/screenplays/university-of-cambridge-building-your-screenplay",
  },
  {
    title:       "Ancient Masterpieces of World Literature",
    description: "Examine how cultures of the ancient world defined themselves through literature, from ancient Mesopotamia and China to classical Greece and Rome.",
    instructor:  "Martin Puchner, David Damrosch",
    category:    "Story",
    url:         "https://www.edx.org/learn/literature/harvard-university-ancient-masterpieces-of-world-literature",
  },
  {
    title:       "First Nights — Monteverdi's L'Orfeo and the Birth of Opera",
    description: "Learn about Claudio Monteverdi's L'Orfeo, one of the first operas ever written.",
    instructor:  "Thomas Forrest Kelly",
    category:    "Music",
    url:         "https://www.edx.org/learn/music-arts/harvard-university-first-nights-monteverdis-lorfeo-and-the-birth-of-opera",
  },
  {
    title:       "Dante Alighieri: Science and poetry in The Divine Comedy",
    description: "Explore Dante's Divine Comedy through a discussion of the sources and references of the poetry and modern science.",
    instructor:  "Raffaele Giglio",
    category:    "Story",
    url:         "https://www.edx.org/learn/literature/universita-degli-studi-di-napoli-federico-ii-dante-alighieri-science-and-poetry-in-the-divine-comedy",
  },
  {
    title:       "Ancient Egyptian Art and Archaeology",
    description: "Explore the archaeology, history, art, and hieroglyphs surrounding the famous Egyptian Pyramids at Giza.",
    instructor:  "Peter Der Manuelian",
    category:    "History",
    url:         "https://www.edx.org/learn/archaeology/harvard-university-pyramids-of-giza-ancient-egyptian-art-and-archaeology",
  },
  {
    title:       "Graphic Design Specialization",
    description: "This series of courses, offered by CalArts, teaches the fundamentals of graphic design including typography, imagemaking, composition, and branding.",
    instructor:  "Michael Worthington",
    category:    "Design",
    url:         "https://www.coursera.org/specializations/graphic-design",
  },
  {
    title:       "Graphic Design Bootcamp",
    description: "Hands-on tutorials for creating design projects like logos, business cards, and social media graphics.",
    instructor:  "Derrick Mitchell",
    category:    "Design",
    url:         "https://www.udemy.com/course/graphic-design-bootcamp",
  },
];

/** All unique filter categories derived from the dataset, in display order */
export const filterTags = [
  "All",
  "AI",
  "Anatomy",
  "Architecture",
  "Art",
  "Biology",
  "Buckhouse",
  "Color",
  "Computer Science",
  "Dance",
  "Design",
  "Drawing",
  "Film",
  "Game Design",
  "History",
  "Jobs",
  "Music",
  "Philosophy",
  "Science",
  "Story",
  "Tools",
  "Typography",
];
