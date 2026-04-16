# DESIGN BRIEF: jamesbuckhouse.com → macOS Big Sur Restyle

## Reference Screenshots Captured
- `reference-screenshot.png` — full homepage (art gallery), 1440×900
- `reference-art.png` — art section
- `reference-film.png` — film section
- `reference-library.png` — library section
- `reference-about.png` — about section
- `reference-hotline.png` — 24-hour hotline (design) section
- `big-sur-wallpaper.png` — Big Sur aerial landscape reference
- `big-sur-hero.png` — macOS Big Sur hero announcement image
- `big-sur-widgets.png` — macOS Big Sur widget design reference

---

## 1. Content Inventory

### Navigation Items (both mobile and desktop nav)
| Label | Emoji | Route |
|---|---|---|
| Art | ✎ | `#/` |
| 24-Hour Hotline | ☎ | `#/design` |
| Library | 📖 | `#/library` |
| Film | 🎬 | `#/film` |
| Buckhouse | 👤 | `#/about` |
| Newsletter | 📰 | `https://jamesbuckhouse.substack.com/` (external, right-aligned) |

---

### Art Section (`#/`) — 45 Artworks

| # | Title | Image URL | Route |
|---|---|---|---|
| 1 | Maryon Park Installation View | https://jamesbuckhouse.com/images/image_66.jpg | `#/art/1` |
| 2 | Maryon Park (side view) | https://jamesbuckhouse.com/images/image_67.jpg | `#/art/2` |
| 3 | Maryon Park Detail | https://jamesbuckhouse.com/images/image_65.jpg | `#/art/3` |
| 4 | Big Sur | https://jamesbuckhouse.com/images/image_1.jpg | `#/art/4` |
| 5 | Double Exposure | https://jamesbuckhouse.com/images/image_3.jpg | `#/art/5` |
| 6 | Conservatory of Flowers | https://jamesbuckhouse.com/images/image_4.jpg | `#/art/6` |
| 7 | Conservatory of Flowers II | https://jamesbuckhouse.com/images/image_61.jpg | `#/art/7` |
| 8 | Donner und Blitz (Hotel) | https://jamesbuckhouse.com/images/image_10.jpg | `#/art/8` |
| 9 | Donner und Blitz (Hotel) Side View | https://jamesbuckhouse.com/images/image_63.jpg | `#/art/9` |
| 10 | Donner und Blitz (Collapsed House) | https://jamesbuckhouse.com/images/image_38.jpg | `#/art/10` |
| 11 | Wild Kigers | https://jamesbuckhouse.com/images/image_52.jpg | `#/art/11` |
| 12 | Homeward Abstraction | https://jamesbuckhouse.com/images/image_9.jpg | `#/art/12` |
| 13 | AR Paris Dance (Sketch) | https://jamesbuckhouse.com/images/image_6.jpg | `#/art/13` |
| 14 | AR Paris Dance (Sketch) II | https://jamesbuckhouse.com/images/image_42.jpg | `#/art/14` |
| 15 | Bridge of Sighs | https://jamesbuckhouse.com/images/image_5.jpg | `#/art/15` |
| 16 | Fixpencil | https://jamesbuckhouse.com/images/image_7.jpg | `#/art/16` |
| 17 | Ocean Sketch | https://jamesbuckhouse.com/images/image_8.jpg | `#/art/17` |
| 18 | Ocean Watercolor | https://jamesbuckhouse.com/images/image_58.jpg | `#/art/18` |
| 19 | Imaginary Wave | https://jamesbuckhouse.com/images/image_59.jpg | `#/art/19` |
| 20 | Homeward Ballet | https://jamesbuckhouse.com/images/image_27.jpg | `#/art/20` |
| 21 | Homeward Ballet | https://jamesbuckhouse.com/images/image_28.jpg | `#/art/21` |
| 22 | Homeward Ballet | https://jamesbuckhouse.com/images/image_29.jpg | `#/art/22` |
| 23 | Homeward Ballet | https://jamesbuckhouse.com/images/image_30.jpg | `#/art/23` |
| 24 | Homeward Ballet | https://jamesbuckhouse.com/images/image_32.jpg | `#/art/24` |
| 25 | Homeward Ballet | https://jamesbuckhouse.com/images/image_57.jpg | `#/art/25` |
| 26 | Homeward Ballet | https://jamesbuckhouse.com/images/image_56.jpg | `#/art/26` |
| 27 | Homeward Ballet | https://jamesbuckhouse.com/images/image_37.jpg | `#/art/27` |
| 28 | Homeward Ballet (Three Graces) | https://jamesbuckhouse.com/images/image_41.jpg | `#/art/28` |
| 29 | Homeward Ballet | https://jamesbuckhouse.com/images/image_46.jpg | `#/art/29` |
| 30 | Homeward Ballet Costumes | https://jamesbuckhouse.com/images/image_36.jpg | `#/art/30` |
| 31 | Homeward Ballet Costumes (sketch) | https://jamesbuckhouse.com/images/image_34.jpg | `#/art/31` |
| 32 | Video Installation | https://jamesbuckhouse.com/images/image_33.jpg | `#/art/32` |
| 33 | Sensorium Installation | https://jamesbuckhouse.com/images/image_44.jpg | `#/art/33` |
| 34 | Sensorium Installation | https://jamesbuckhouse.com/images/image_45.jpg | `#/art/34` |
| 35 | Hand on Glass | https://jamesbuckhouse.com/images/image_39.jpg | `#/art/35` |
| 36 | Friends and Strangers | https://jamesbuckhouse.com/images/image_40.jpg | `#/art/36` |
| 37 | Friends and Strangers | https://jamesbuckhouse.com/images/image_60.jpg | `#/art/37` |
| 38 | Sketchbook | https://jamesbuckhouse.com/images/image_43.jpg | `#/art/38` |
| 39 | Oil Studies | https://jamesbuckhouse.com/images/image_47.jpg | `#/art/39` |
| 40 | Working Rope | https://jamesbuckhouse.com/images/image_48.jpg | `#/art/40` |
| 41 | Aleatoric Rope | https://jamesbuckhouse.com/images/image_53.jpg | `#/art/41` |
| 42 | Taut Rope | https://jamesbuckhouse.com/images/image_55.jpg | `#/art/42` |
| 43 | Bird and Fly | https://jamesbuckhouse.com/images/image_51.jpg | `#/art/43` |
| 44 | Half Moon Bay | https://jamesbuckhouse.com/images/image_62.jpg | `#/art/44` |
| 45 | Drawing Table | https://jamesbuckhouse.com/images/image_54.jpg | `#/art/45` |

---

### Film Section (`#/film`) — 12 Films

**Intro text:** "I got my start lensing shots, crafting character arcs, and punching up story for some of the biggest franchises in popular entertainment, including **Shrek**, **Madagascar**, and **The Matrix** trilogies. Today I collaborate with some of Hollywood's best directors, producers, writers, and showrunners to create new stories and new experiences for stage, screen, and stream."

| Title | Poster URL | IMDB Link |
|---|---|---|
| Carmen | https://jamesbuckhouse.com/images/film-posters/carmen.jpg | https://www.imdb.com/title/tt6875952/ |
| Matrix Revolutions | https://jamesbuckhouse.com/images/film-posters/matrix.jpg | https://www.imdb.com/title/tt0242653/ |
| Monsters vs. Aliens | https://jamesbuckhouse.com/images/film-posters/mva.jpg | https://www.imdb.com/title/tt0892782/ |
| Madagascar Escape 2 Africa | https://jamesbuckhouse.com/images/film-posters/mad2.jpg | https://www.imdb.com/title/tt0479952 |
| Madagascar | https://jamesbuckhouse.com/images/film-posters/mad.jpg | https://www.imdb.com/title/tt0351283 |
| Penguins Christmas Caper | https://jamesbuckhouse.com/images/film-posters/caper.jpg | https://www.imdb.com/title/tt0484439 |
| Shrek the Halls | https://jamesbuckhouse.com/images/film-posters/halls.jpg | https://www.imdb.com/title/tt0897387 |
| Shrek the Third | https://jamesbuckhouse.com/images/film-posters/shrek3.jpg | https://www.imdb.com/title/tt0413267 |
| Shrek 2 | https://jamesbuckhouse.com/images/film-posters/shrek2.jpg | https://www.imdb.com/title/tt0298148 |
| Shrek | https://jamesbuckhouse.com/images/film-posters/shrek.jpg | https://www.imdb.com/title/tt0126029 |
| Antz | https://jamesbuckhouse.com/images/film-posters/antz.jpg | https://www.imdb.com/title/tt0120587 |
| The Peacemaker | https://jamesbuckhouse.com/images/film-posters/peacemaker.jpg | https://www.imdb.com/title/tt0119874 |

---

### Library Section (`#/library`)

**Heading:** "Library"

**Body text:** "I put together this small athenaeum of courses and resources collected from across the internet. Some of these I've created, others are from other people."

**CTA:** "Please suggest a new course or resource." → https://airtable.com/appqB1VAs2ZN5Df6j/pagOX4Og9v5aytpYf/form

**Filter tags (buttons):**
All, AI, Anatomy, Architecture, Art, Biology, Buckhouse, Color, Computer Science, Dance, Design, Drawing, Film, Game Design, History, Jobs, Music, Philosophy, Science, Story, Tools, Typography

**Library Items (partial — page renders many):**

| Title | Description | Instructor | URL |
|---|---|---|---|
| Omens Oracles & Prophecies | Oracles & Prophecies provides an overview of divination systems, ranging from ancient Chinese bone burning to modern astrology... | Alyssa Goodman | https://www.edx.org/learn/social-science/harvard-university-predictionx-omens-oracles-prophecies |
| Lost Without Longitude | Explore the tools and techniques of navigation, with a particular focus on the importance (and difficulty) of measuring longitude. | Alyssa Goodman | https://www.edx.org/learn/astronomy/harvard-university-predictionx-lost-without-longitude |
| John Snow and the Cholera Epidemic of 1854 | An in-depth look at the 1854 London cholera epidemic in Soho and its importance for the field of epidemiology. | Alyssa Goodman | https://www.edx.org/learn/history/harvard-university-predictionx-john-snow-and-the-cholera-epidemic-of-1854 |
| Shakespeare and His World | Explore the life, works, and times of William Shakespeare, from his birthplace in Stratford-upon-Avon to the London playhouses. | Stephen Greenblatt | https://www.edx.org/learn/shakespeare/harvard-university-shakespeare-and-his-world |
| Rhetoric: The Art of Persuasive Writing and Public Speaking | Gain critical communication skills in writing and public speaking with this introduction to American political rhetoric. | James Engell | https://www.edx.org/learn/rhetoric/harvard-university-rhetoric-the-art-of-persuasive-writing-and-public-speaking |
| Building your Screenplay | Learn to strengthen your skills as a screenwriter, while diversifying your knowledge and understanding of the demands of global film and TV production. | Abigail Docherty | https://www.edx.org/learn/screenplays/university-of-cambridge-building-your-screenplay |
| Ancient Masterpieces of World Literature | Examine how cultures of the ancient world defined themselves through literature... | Martin Puchner, David Damrosch | https://www.edx.org/learn/literature/harvard-university-ancient-masterpieces-of-world-literature |
| First Nights - Monteverdi's L'Orfeo and the Birth of Opera | Learn about Claudio Monteverdi's L'Orfeo, one of the first operas ever written. | Thomas Forrest Kelly | https://www.edx.org/learn/music-arts/harvard-university-first-nights-monteverdis-lorfeo-and-the-birth-of-opera |
| Dante Alighieri: Science and poetry in The Divine Comedy | Explore Dante's Divine Comedy through a discussion of the sources and references of the poetry and modern science | Raffaele Giglio | https://www.edx.org/learn/literature/universita-degli-studi-di-napoli-federico-ii-dante-alighieri-science-and-poetry-in-the-divine-comedy |
| Ancient Egyptian Art and Archaeology | Explore the archaeology, history, art, and hieroglyphs surrounding the famous Egyptian Pyramids at Giza... | Peter Der Manuelian | https://www.edx.org/learn/archaeology/harvard-university-pyramids-of-giza-ancient-egyptian-art-and-archaeology |
| Graphic Design Specialization | This series of courses, offered by CalArts, teaches the fundamentals of graphic design... | Michael Worthington | https://www.coursera.org/specializations/graphic-design |
| Graphic Design Bootcamp | Hands-on tutorials for creating design projects like logos, business cards, and social media graphics. | Derrick Mitchell | https://www.udemy.com/course/graphic-design-bootcamp |

_(Additional library items exist beyond the visible viewport — all are fetched from the data source. The JS data file preserves the full list.)_

---

### About Section (`#/about`)

**Profile image:** https://jamesbuckhouse.com/images/James_Buckhouse_Profile_Pic.jpg

**Bio text:** "James Buckhouse believes story, art, and design can bend the arc of humanity's progress, if you do it right, and brings that idea into everything he does: from movies to startups to paintings to books and to [ballets](https://www.instagram.com/p/CG6c1ijpwIo/). As an artist, he has exhibited at the [Whitney Biennial](https://whitney.org/artists/t3540), the Solomon R. Guggenheim's Works & Process Series, The Institute of Contemporary Art in London, The Berkeley Art Museum, and the Dia Center. He has collaborated with leading choreographers at the New York City Ballet, San Francisco Ballet, LA Dance Project, Oregon Ballet Theatre, and Pennsylvania Ballet. As [Design Partner](https://www.sequoiacap.com/people/james-buckhouse/) at Sequoia, he [works with founders](https://www.sequoiacap.com/article/seven-questions-with-james-buckhouse/) from idea to IPO and beyond to help them design their companies, products, cultures, and businesses. Buckhouse got his start in [film](/film), lensing shots, crafting character arcs, and punching up story for the [Shrek, Madagascar, and Matrix](/film) series. He regularly guest lectures at [Harvard GSD](https://buckhouse.medium.com/the-structure-of-story-reading-list-fa8308a87860), Yale Architecture, [Stanford GSB](https://www.youtube.com/watch?v=hG5i05kRYmk), and d.school. Previously at Twitter, he authored [UX patents](https://read.cv/buckhouse) for emoji replies and social opinion polls."

**Social links:**
| Label | URL |
|---|---|
| LinkedIn | https://www.linkedin.com/in/jamesbuckhouse/ |
| Twitter | https://x.com/buckhouse |
| Instagram | https://www.instagram.com/buckhouse/ |
| Read.cv | https://read.cv/buckhouse |
| Delphi | https://www.delphi.ai/buckhouse |
| Newsletter | https://jamesbuckhouse.substack.com/ |

---

### 24-Hour Hotline Section (`#/design`)

This section embeds an iframe (appears to be a Substack or external embed for a design hotline). The iframe renders within the content area below the navbar. No additional text content extracted — the iframe is the primary content.

---

## 2. Layout & Structure

### Sections / Pages
1. **Art Gallery** (`#/`) — default/home
2. **24-Hour Hotline** (`#/design`) — iframe embed
3. **Library** (`#/library`) — filterable resource list
4. **Film** (`#/film`) — film grid with intro paragraph
5. **About / Buckhouse** (`#/about`) — profile + bio + social links

### Navigation Structure
- **Navbar**: Fixed top, 60px height, semi-transparent background (`rgba(245, 243, 242, 0.85)`), `z-index` stacked above content
- **Left side**: Logo area / nav links list (5 items with emoji prefixes)
- **Right side**: "📰 Newsletter" external link
- **Mobile**: Hamburger menu collapses nav

### Art Grid Layout
- Grid: `3 columns × N rows` (auto-fill at `376px` per column)
- Column gap: `20px`
- Grid class: `.gallery-grid`
- Each card: `.artwork-card-link` wrapping `.artwork-card-sizer`
- Card dimensions: `376×376px` (square)
- Image border-radius: `8px`
- Card container border-radius: `0px` (no outer radius)
- Card has: image + title overlay (`.artwork-card-title`)

### Film Layout
- Intro paragraph at top
- Grid of film poster cards (appears 3-4 columns)
- Each card: poster image + `<h3>` title below, wrapped in external IMDB link

### Library Layout
- `<h1>Library</h1>` heading
- Intro paragraph
- Airtable suggestion link
- Horizontal filter-bar (scrollable row of buttons)
- Grid of course cards (each: `<h3>` title, description `<p>`, Instructor `<p>`, Prerequisites `<p>`, "Learn More" `<p>`)
- No images in library cards — text-only

### About Layout
- Profile photo (top, likely circular or square cropped)
- Long-form bio paragraph with inline links
- Social icons row (Font Awesome icons + text labels)

---

## 3. Original Visual Design Tokens (jamesbuckhouse.com)

### Colors (from CSS custom properties)
```
--bg-white:          #E5E2E1   (body background)
--bg-white-half:     #fcfbf6   (lighter bg variant)
--semi-bg-color:     #f1efee   (card / surface bg)
--primary-color:     #2c3e50
--secondary-color:   #2c3e50
--text-color:        #333333   (body text)
--text-visited-color: #000000
--hover-color:       #2c3e50
--primary-hover-color: #507091
```

**Category-specific accent colors (library filter tags):**
```
--history-color:      #ff6b00
--science-color:      #00d4ff
--biology-color:      #00ff88
--story-color:        #ff00c8
--architecture-color: #8400ff
--design-color:       #ff0051
--art-color:          #ffb300
--tools-color:        #4a4a4a
--film-color:         #5900ff
--typography-color:   #00ffd5
--anatomy-color:      #ff006e
--color-color:        #00ff51
```

### Typography
```
--menu-font-family:    "Pitch Sans", sans-serif
--heading-font-family: "FinancierDisplay", serif
--body-font-family:    "Unica77", sans-serif
body font-size:        16px
body line-height:      normal (browser default)
```

### Spacing
```
--spacing-xs:   0.25rem (4px)
--spacing-sm:   0.5rem  (8px)
--spacing-md:   1rem    (16px)
--spacing-lg:   1.5rem  (24px)
--spacing-xl:   2rem    (32px)
--spacing-xxl:  3rem    (48px)
--container-width: 1200px
--navbar-height:   60px
```

### Transitions
```
--transition-fast:   0.2s ease
--transition-normal: 0.3s ease
--transition-slow:   0.5s ease
```

### Effects
- No `backdrop-filter` on navbar in original (plain semi-transparent bg)
- Card image: `border-radius: 8px`
- Grid gap: `20px`

---

## 4. Big Sur Visual Language (Target)

### Reference Images Analysis

**big-sur-wallpaper.png** — Aerial coastal landscape:
- Color palette: golden-ochre hillsides, blue-grey ocean, white fog banks drifting through valleys, sky transitioning warm gold → cool blue at horizon
- Key tones: `#c4a870` (warm hillside), `#7a9ab5` (ocean blue-grey), `#e8e0cf` (fog white), `#4a6b8a` (deep water), `#b5975a` (sunset gold)
- Mood: cinematic, late-afternoon light, warm-to-cool gradient

**big-sur-hero.png** — Apple macOS Big Sur announcement:
- Text: "macOS" (small, SF Pro), "Big Sur" (massive SF Pro Display, weight 700, white)
- Background: same aerial shot with rich depth-of-field softness in foreground
- Text is center-aligned with generous spacing
- Color temperature: warm amber foreground, cool blue distance
- Strong atmospheric perspective / depth layering

**big-sur-widgets.png** — macOS Big Sur Desktop UI:
- Frosted glass widget panels: translucent light panels with blur visible through them
- Widget cards: `border-radius: ~16-20px`, white/light-grey surfaces
- Soft box shadows: diffuse, not sharp
- Dock at bottom: large icons, rounded square shapes with heavy radius
- Color: warm off-white system tones (`#f5f5f5`, `#ebebeb`)
- Gradient mesh background: flowing blue/purple/teal swirling gradients
- Fine strokes/dividers: very light `rgba(0,0,0,0.08)`
- Typography: SF Pro with medium-to-bold weights, tight tracking on headings

---

## 5. Target Design Tokens (Big Sur Restyle)

### Color Palette
```css
/* Backgrounds */
--bg-hero-start:    #f5e6c8   /* warm dusk peach */
--bg-hero-mid:      #c9bde0   /* soft lavender */
--bg-hero-end:      #2d4a6e   /* deep coastal blue */
--bg-surface:       rgba(255, 252, 248, 0.72)  /* frosted warm white */
--bg-nav:           rgba(250, 247, 243, 0.80)  /* navbar frosted glass */
--bg-card:          rgba(255, 253, 250, 0.65)  /* card frosted surface */
--bg-overlay:       rgba(255, 255, 255, 0.12)  /* hover overlay */

/* Text */
--text-primary:     #1d1d1f   /* Apple warm black */
--text-secondary:   #6e6e73   /* Apple secondary grey */
--text-tertiary:    #aeaeb2   /* light metadata */
--text-on-dark:     #f5f5f7   /* white-ish for dark sections */

/* Accents */
--accent-warm:      #d4945a   /* warm amber / Big Sur gold */
--accent-cool:      #4a7fa8   /* coastal blue */
--accent-purple:    #8b6bb1   /* lavender accent */
--border-subtle:    rgba(0, 0, 0, 0.08)
--border-card:      rgba(255, 255, 255, 0.40)
```

### Typography (Big Sur restyle)
```css
/* Primary: SF Pro (system) with Inter fallback */
--font-display:   "SF Pro Display", "Inter", -apple-system, sans-serif
--font-text:      "SF Pro Text", "Inter", -apple-system, sans-serif
--font-mono:      "SF Mono", monospace

/* Scale */
--text-hero:      clamp(3rem, 7vw, 6rem)      /* 48–96px, weight 700 */
--text-section:   clamp(1.75rem, 3vw, 2.5rem) /* 28–40px, weight 600 */
--text-h3:        1.125rem                     /* 18px, weight 600 */
--text-body:      1rem                         /* 16px, weight 400 */
--text-caption:   0.875rem                     /* 14px, weight 400 */
--text-nav:       0.9375rem                    /* 15px, weight 500 */

/* Tracking */
--tracking-display: -0.02em
--tracking-tight:   -0.01em

/* Line heights */
--leading-tight:  1.1
--leading-normal: 1.5
--leading-relaxed: 1.7
```

### Spacing (Apple product-page generosity)
```css
--spacing-xs:    0.25rem   /* 4px */
--spacing-sm:    0.5rem    /* 8px */
--spacing-md:    1rem      /* 16px */
--spacing-lg:    1.5rem    /* 24px */
--spacing-xl:    2rem      /* 32px */
--spacing-2xl:   3rem      /* 48px */
--spacing-3xl:   5rem      /* 80px */
--spacing-section: 7.5rem  /* 120px — Apple product-page generosity */

--container-max: 1200px
--navbar-height: 60px
--card-gap:      24px
```

### Border Radii
```css
--radius-sm:     8px    /* image thumbnails */
--radius-md:     16px   /* cards */
--radius-lg:     24px   /* large panels */
--radius-xl:     28px   /* hero containers */
--radius-full:   9999px /* pills / tags */
--radius-nav:    12px   /* buttons in nav */
```

### Shadows / Elevation
```css
/* Big Sur's soft diffuse shadows — nothing flat, everything floats */
--shadow-card:   0 4px 16px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04);
--shadow-hover:  0 20px 40px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.06);
--shadow-nav:    0 1px 20px rgba(0,0,0,0.08);
--shadow-modal:  0 40px 80px rgba(0,0,0,0.20), 0 8px 24px rgba(0,0,0,0.10);
```

### Effects
```css
/* Frosted glass (navbar, overlays, modals) */
--glass-nav:   backdrop-filter: blur(20px) saturate(180%);
--glass-card:  backdrop-filter: blur(12px) saturate(150%);
--glass-modal: backdrop-filter: blur(40px) saturate(200%);
```

---

## 6. Component Patterns

### Navbar
- **Original**: Fixed, `60px` tall, semi-transparent `rgba(245,243,242,0.85)`, Pitch Sans font, no backdrop-filter, plain border-bottom
- **Big Sur**: Fixed, `60px` tall, frosted glass (`backdrop-filter: blur(20px) saturate(180%)`), warm off-white base `rgba(250,247,243,0.80)`, very subtle shadow `0 1px 20px rgba(0,0,0,0.08)`, border-bottom: `1px solid rgba(255,255,255,0.40)`
- Nav links: SF Pro Text 15px weight 500, emoji prefix preserved, pill hover state with `border-radius: 8px` background reveal
- Newsletter link: right-aligned, pill-shaped button style with `border-radius: 12px`

### Artwork Card (Art Grid)
- **Original**: `376×376px` square, image with `border-radius: 8px`, title overlay at bottom, no card container radius
- **Big Sur**:
  - Container: `border-radius: 16px`, overflow hidden, frosted glass backing `rgba(255,253,250,0.65)`
  - Image: fills card, `border-radius: 16px` (inherited), breathing animation: `scale(1.0→1.03)` over 10s infinite ease-in-out
  - Title: appears below image on hover, fade-in, SF Pro Text 14px
  - Hover: `translateY(-4px)` + shadow expansion with spring cubic-bezier `(0.34, 1.56, 0.64, 1)`
  - Scroll reveal: `opacity: 0 → 1` + `translateY(20px → 0)` via IntersectionObserver, staggered 60ms per item

### Film Poster Card
- **Original**: Poster image (portrait orientation) + `<h3>` title, wrapped in IMDB link
- **Big Sur**:
  - Card: `border-radius: 16px`, soft shadow, frosted surface
  - Poster: `border-radius: 12px`, breathing animation 8-12s
  - Title: SF Pro Text, 16px weight 600, below image with 12px margin
  - Hover: spring lift + shadow
  - Links open in new tab (IMDB)

### Library Card
- **Original**: Text-only — title `<h3>`, description `<p>`, Instructor, Prerequisites, "Learn More" link, no image
- **Big Sur**:
  - Card surface: `rgba(255,252,248,0.72)` with `backdrop-filter: blur(12px)`, `border-radius: 16px`
  - Title: SF Pro Display 18px weight 600, tracking -0.01em
  - Description: SF Pro Text 14-15px, line-height 1.6, text-secondary color
  - Instructor/Prerequisites: 13px, text-tertiary
  - "Learn More": small pill button, accent-warm color
  - Left accent border: 3px colored stripe using category color (maps to existing category color vars)

### Filter Bar (Library)
- **Original**: Horizontal row of plain buttons
- **Big Sur**:
  - Horizontally scrollable row, `padding-bottom: 4px` for scrollbar clearance
  - Each button: `border-radius: 9999px` (pill), `font-size: 14px`, `font-weight: 500`
  - Inactive: `rgba(0,0,0,0.06)` bg, `--text-secondary` color
  - Active: frosted glass `rgba(255,255,255,0.80)` bg, `--text-primary` color, shadow `0 2px 8px rgba(0,0,0,0.10)`
  - Hover: spring-physics transition

### About Section
- **Original**: Profile photo + long paragraph + social icon links
- **Big Sur**:
  - Profile photo: large, `border-radius: 24px` (not circular — more Mac widget feel), subtle shadow
  - Bio text: SF Pro Text 17-18px, line-height 1.7, text-primary, generous paragraph spacing
  - Social links: frosted glass pill buttons, icon + text, `border-radius: 12px`
  - Layout: centered or 2-column with photo left, bio right at desktop

### Lightbox (Artwork Detail)
- **Original**: Full-screen image on click to `#/art/:id`
- **Big Sur**:
  - Backdrop: `backdrop-filter: blur(40px) saturate(200%)` + `rgba(0,0,0,0.60)` overlay
  - Panel: `border-radius: 24px`, white frosted surface, FLIP animation (scale from thumbnail bounds)
  - Spring open/close: `cubic-bezier(0.34, 1.56, 0.64, 1)`
  - Image: fills panel, `border-radius: 16px`

### Hero Background (Gradient Mesh)
- Animated gradient mesh evoking Big Sur dusk — slow drift, 30s+ keyframes
- Key stops: peach `#f5e6c8` → lavender `#c9bde0` → deep blue `#2d4a6e`
- Implementation: CSS `@keyframes` on a background gradient or layered pseudo-elements
- Never triggers layout changes — only `background-position` or `transform` animates

---

## 7. Motion & Animation Specifications

### Scroll-Driven Parallax
- **Elements**: Hero section background, artwork card images
- **Speed**: Images translate at `0.3×–0.6×` scroll rate (`translateY(scrollY * 0.4)`)
- **Implementation**: `requestAnimationFrame` loop, `transform` only
- **Reduced motion**: completely disabled via `@media (prefers-reduced-motion: reduce)`

### Card Breathing (Live Images)
```css
@keyframes breathe {
  0%, 100% { transform: scale(1.0); }
  50%       { transform: scale(1.03); }
}
/* Duration: 10s, timing: ease-in-out, infinite */
/* Disabled under prefers-reduced-motion */
```

### Hover Spring
```css
transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 0.3s ease;
/* On hover: translateY(-4px) + shadow-hover */
```

### Staggered Scroll Reveals
```js
// IntersectionObserver on .artwork-card-link, .film-card, .library-card
// Each item: opacity 0→1 + translateY(20px→0)
// Stagger: itemIndex * 60ms delay
// Duration: 400ms ease-out
```

### Route Transitions
- Crossfade: current section `opacity: 1→0`, new section `opacity: 0→1`
- Subtle scale: `scale(0.98→1.0)` on entry
- Duration: 300ms ease

### Gradient Mesh Drift
```css
@keyframes meshDrift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
/* Applied to hero/body bg gradient */
/* Duration: 30s, ease, infinite */
```

---

## 8. Performance Constraints

- All animations use `transform` and `opacity` only — **no** `width`, `height`, `top`, `left`, `margin` animations
- Breathing animation: applied to `<img>` elements directly, not containers (avoids layout triggers)
- Parallax: only on `translate3d(0, y, 0)` — triggers GPU composite layer
- Target: **60fps on 2020 MacBook Air** (Apple M1)
- Lightbox uses FLIP technique: measure thumbnail bounds before expand → animate with `transform`
- `will-change: transform` on card images and parallax containers

---

## 9. Responsive Breakpoints

```css
/* Desktop first (original site was desktop-focused) */
@media (max-width: 1024px) { /* tablet: 2-col grid */ }
@media (max-width: 768px)  { /* mobile: 1-col grid, hamburger nav */ }
```

### Grid at each breakpoint:
- Desktop (≥1025px): 3 columns, 376px per card
- Tablet (768–1024px): 2 columns, fluid
- Mobile (<768px): 1 column, full-width

---

## 10. Accessibility Notes

- `prefers-reduced-motion`: all breathing, parallax, and drift animations fully disabled
- Color contrast: `--text-primary #1d1d1f` on `rgba(255,252,248,0.72)` surface ✓ (≥7:1 on solid white equivalent)
- All images have `alt` text (preserved from original)
- Filter buttons: need `aria-pressed` state for active filter
- Lightbox: trap focus within modal, `Escape` to close, `aria-modal="true"`

---

## 11. File Architecture (Target HTML/CSS/JS)

```
index.html
src/
  css/
    tokens/
      colors.css        ← Big Sur palette
      typography.css    ← SF Pro / Inter scale
      spacing.css       ← Apple-generous spacing
      radii.css         ← 16–28px radius system
      shadows.css       ← Soft diffuse elevation
      transitions.css   ← Spring curves
    base.css            ← reset + body gradient mesh
    main.css            ← imports all tokens + component files
    components/
      navbar.css
      gallery-grid.css
      artwork-card.css
      film-card.css
      library-card.css
      filter-bar.css
      lightbox.css
      footer.css
      hotline.css
      about.css
    states.css          ← hover, active, focus states
    utilities.css       ← parallax, reveal, breathing classes
  js/
    main.js             ← router + init
    router.js           ← hash routing
    ArtworkCard.js
    FilmCard.js
    LibraryCard.js
    FilterBar.js
    Lightbox.js
    Navbar.js
    GalleryGrid.js
    FilmSection.js
    LibrarySection.js
    AboutSection.js
    HotlineEmbed.js
    Footer.js
    data/
      artworks.js       ← 45 artworks (all URLs preserved)
      films.js          ← 12 films (all poster URLs + IMDB links)
      library-items.js  ← all courses/resources
```

---

## 12. Key Differences: Original → Big Sur

| Aspect | Original | Big Sur Target |
|---|---|---|
| Body bg | `#E5E2E1` flat warm grey | Drifting gradient mesh (peach→lavender→blue) |
| Navbar | Semi-transparent, no blur | Frosted glass, `backdrop-filter: blur(20px)` |
| Fonts | Unica77 / Pitch Sans / FinancierDisplay | SF Pro / Inter system stack |
| Card radius | `8px` image only | `16px` full card with glass surface |
| Card hover | Likely simple opacity or scale | Spring physics lift + shadow expansion |
| Animations | None visible | Breathing (10s), stagger reveals, parallax |
| Shadows | Minimal | Soft diffuse multi-layer |
| Spacing | Moderate | Apple product-page generous (120px+ sections) |
| Lightbox | Navigate to route | FLIP spring-physics modal with glass backdrop |
| Gradient | None | 30s+ drifting mesh background |
