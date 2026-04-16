# DESIGN.md — jamesbuckhouse.com × macOS Big Sur Restyle

> Written in the "Coding Backwards" methodology: this document describes the finished site as if it already exists, forcing clarity before the first line of implementation is written.

---

## 1. Project Overview

### What Was Built

A pixel-faithful content restyle of **jamesbuckhouse.com** — the portfolio of James Buckhouse, Design Partner at Sequoia Capital and artist exhibited at the Whitney Biennial. The site contains five sections: an art gallery of 45 works, a film section covering 12 major productions, a curated library of learning resources, an about/bio section, and a 24-hour design hotline iframe embed.

The restyle applied the **macOS Big Sur** visual language to this existing content: the drifting dusk gradient mesh from the Big Sur wallpaper, frosted-glass surfaces used *selectively* (navbar and lightbox only — not on every card), soft diffuse shadows, generous Apple product-page spacing, and spring-physics motion. The result feels like a native macOS window opened onto James's work.

### Technology Choice

**Plain HTML/CSS/JS — no build step, no framework.**

James's site is five content sections with hash-based routing. There is no state management problem, no server rendering need, no component reuse at framework scale. A vanilla approach gives direct control over every animation frame, zero bundle overhead for 60fps targets, and immediate portability. The original site used this stack; the restyle preserved it.

CSS custom properties carry the full design token system. ES modules organize the JS. Bun serves as the local preview server.

### How the Design Specification Was Achieved

The brief was complete and precise — all 45 artwork URLs verified from the live site, exact `cubic-bezier` values specified, Big Sur color palette extracted from the actual wallpaper. The critique identified four spec decisions that would have made the site read as AI-generated:

1. **Left border stripe on library cards** → replaced with a small pill badge in the card's upper-right corner
2. **Inter as the primary font fallback** → removed; FinancierDisplay (the original brand font) was kept for hero and section headings, with a proper system UI stack for body text
3. **Frosted glass on every surface** → restricted to navbar, lightbox backdrop, and the hero overlay panel only — artwork cards use a clean warm-white surface so the art is not competing with its own frame
4. **meshDrift animating `background-position`** → reimplemented as a `transform: translateX()` on a wide pseudo-element, keeping the animation on the compositor thread

All four anti-patterns from the critique were resolved before implementation.

---

## 2. Content Integration Plan

Every piece of real content from the design references is used. No placeholders exist in the finished site.

### Navigation

| Label | Emoji | Route | Notes |
|---|---|---|---|
| Art | ✎ | `#/` | Default/home section |
| 24-Hour Hotline | ☎ | `#/design` | External iframe embed |
| Library | 📖 | `#/library` | Filterable resource grid |
| Film | 🎬 | `#/film` | Film poster grid |
| Buckhouse | 👤 | `#/about` | Bio + social links |
| Newsletter | 📰 | `https://jamesbuckhouse.substack.com/` | External, right-aligned pill button |

### Art Section — 45 Artworks

All images are fetched directly from `jamesbuckhouse.com`. The `<img src>` attribute holds the canonical external URL. `alt` text is the artwork title.

| # | Title | Image URL |
|---|---|---|
| 1 | Maryon Park Installation View | `https://jamesbuckhouse.com/images/image_66.jpg` |
| 2 | Maryon Park (side view) | `https://jamesbuckhouse.com/images/image_67.jpg` |
| 3 | Maryon Park Detail | `https://jamesbuckhouse.com/images/image_65.jpg` |
| 4 | Big Sur | `https://jamesbuckhouse.com/images/image_1.jpg` |
| 5 | Double Exposure | `https://jamesbuckhouse.com/images/image_3.jpg` |
| 6 | Conservatory of Flowers | `https://jamesbuckhouse.com/images/image_4.jpg` |
| 7 | Conservatory of Flowers II | `https://jamesbuckhouse.com/images/image_61.jpg` |
| 8 | Donner und Blitz (Hotel) | `https://jamesbuckhouse.com/images/image_10.jpg` |
| 9 | Donner und Blitz (Hotel) Side View | `https://jamesbuckhouse.com/images/image_63.jpg` |
| 10 | Donner und Blitz (Collapsed House) | `https://jamesbuckhouse.com/images/image_38.jpg` |
| 11 | Wild Kigers | `https://jamesbuckhouse.com/images/image_52.jpg` |
| 12 | Homeward Abstraction | `https://jamesbuckhouse.com/images/image_9.jpg` |
| 13 | AR Paris Dance (Sketch) | `https://jamesbuckhouse.com/images/image_6.jpg` |
| 14 | AR Paris Dance (Sketch) II | `https://jamesbuckhouse.com/images/image_42.jpg` |
| 15 | Bridge of Sighs | `https://jamesbuckhouse.com/images/image_5.jpg` |
| 16 | Fixpencil | `https://jamesbuckhouse.com/images/image_7.jpg` |
| 17 | Ocean Sketch | `https://jamesbuckhouse.com/images/image_8.jpg` |
| 18 | Ocean Watercolor | `https://jamesbuckhouse.com/images/image_58.jpg` |
| 19 | Imaginary Wave | `https://jamesbuckhouse.com/images/image_59.jpg` |
| 20–27 | Homeward Ballet (series) | `image_27, 28, 29, 30, 32, 57, 56, 37` |
| 28 | Homeward Ballet (Three Graces) | `https://jamesbuckhouse.com/images/image_41.jpg` |
| 29 | Homeward Ballet | `https://jamesbuckhouse.com/images/image_46.jpg` |
| 30 | Homeward Ballet Costumes | `https://jamesbuckhouse.com/images/image_36.jpg` |
| 31 | Homeward Ballet Costumes (sketch) | `https://jamesbuckhouse.com/images/image_34.jpg` |
| 32 | Video Installation | `https://jamesbuckhouse.com/images/image_33.jpg` |
| 33 | Sensorium Installation | `https://jamesbuckhouse.com/images/image_44.jpg` |
| 34 | Sensorium Installation | `https://jamesbuckhouse.com/images/image_45.jpg` |
| 35 | Hand on Glass | `https://jamesbuckhouse.com/images/image_39.jpg` |
| 36–37 | Friends and Strangers | `image_40, image_60` |
| 38 | Sketchbook | `https://jamesbuckhouse.com/images/image_43.jpg` |
| 39 | Oil Studies | `https://jamesbuckhouse.com/images/image_47.jpg` |
| 40 | Working Rope | `https://jamesbuckhouse.com/images/image_48.jpg` |
| 41 | Aleatoric Rope | `https://jamesbuckhouse.com/images/image_53.jpg` |
| 42 | Taut Rope | `https://jamesbuckhouse.com/images/image_55.jpg` |
| 43 | Bird and Fly | `https://jamesbuckhouse.com/images/image_51.jpg` |
| 44 | Half Moon Bay | `https://jamesbuckhouse.com/images/image_62.jpg` |
| 45 | Drawing Table | `https://jamesbuckhouse.com/images/image_54.jpg` |

Each artwork is stored as an object in `src/js/data/artworks.js` with `{ id, title, imageUrl, route }`.

### Film Section — 12 Films

Intro paragraph (verbatim, markup preserved):

> "I got my start lensing shots, crafting character arcs, and punching up story for some of the biggest franchises in popular entertainment, including **Shrek**, **Madagascar**, and **The Matrix** trilogies. Today I collaborate with some of Hollywood's best directors, producers, writers, and showrunners to create new stories and new experiences for stage, screen, and stream."

| Title | Poster URL | IMDB URL |
|---|---|---|
| Carmen | `https://jamesbuckhouse.com/images/film-posters/carmen.jpg` | `https://www.imdb.com/title/tt6875952/` |
| Matrix Revolutions | `https://jamesbuckhouse.com/images/film-posters/matrix.jpg` | `https://www.imdb.com/title/tt0242653/` |
| Monsters vs. Aliens | `https://jamesbuckhouse.com/images/film-posters/mva.jpg` | `https://www.imdb.com/title/tt0892782/` |
| Madagascar Escape 2 Africa | `https://jamesbuckhouse.com/images/film-posters/mad2.jpg` | `https://www.imdb.com/title/tt0479952` |
| Madagascar | `https://jamesbuckhouse.com/images/film-posters/mad.jpg` | `https://www.imdb.com/title/tt0351283` |
| Penguins Christmas Caper | `https://jamesbuckhouse.com/images/film-posters/caper.jpg` | `https://www.imdb.com/title/tt0484439` |
| Shrek the Halls | `https://jamesbuckhouse.com/images/film-posters/halls.jpg` | `https://www.imdb.com/title/tt0897387` |
| Shrek the Third | `https://jamesbuckhouse.com/images/film-posters/shrek3.jpg` | `https://www.imdb.com/title/tt0413267` |
| Shrek 2 | `https://jamesbuckhouse.com/images/film-posters/shrek2.jpg` | `https://www.imdb.com/title/tt0298148` |
| Shrek | `https://jamesbuckhouse.com/images/film-posters/shrek.jpg` | `https://www.imdb.com/title/tt0126029` |
| Antz | `https://jamesbuckhouse.com/images/film-posters/antz.jpg` | `https://www.imdb.com/title/tt0120587` |
| The Peacemaker | `https://jamesbuckhouse.com/images/film-posters/peacemaker.jpg` | `https://www.imdb.com/title/tt0119874` |

Film poster `<img>` elements have `alt` set to the film title. Each card is wrapped in an `<a href>` pointing to the IMDB URL with `target="_blank" rel="noopener"`. Film grid is 4 columns at desktop, 3 at tablet, 2 at mobile — portrait posters are not well-served by anything wider than 4.

### Library Section

**Heading:** "Library"

**Body text:** "I put together this small athenaeum of courses and resources collected from across the internet. Some of these I've created, others are from other people."

**Suggest link:** "Please suggest a new course or resource." → `https://airtable.com/appqB1VAs2ZN5Df6j/pagOX4Og9v5aytpYf/form`

**Filter tags (22 total):**
All, AI, Anatomy, Architecture, Art, Biology, Buckhouse, Color, Computer Science, Dance, Design, Drawing, Film, Game Design, History, Jobs, Music, Philosophy, Science, Story, Tools, Typography

Each filter tag has `aria-pressed` toggled by JS. Active tag gets the pill-active style. "All" is selected on load and shows all items.

**Empty state:** When a filter returns no results, a centered message reads: "*Nothing here yet — [clear filter](#)* " with the inline link resetting to "All."

**Library Items** — stored in `src/js/data/library-items.js` (partial list shown; full dataset in the data file):

| Title | Instructor | Category | URL |
|---|---|---|---|
| Omens Oracles & Prophecies | Alyssa Goodman | Science | edx.org |
| Lost Without Longitude | Alyssa Goodman | Science | edx.org |
| John Snow and the Cholera Epidemic of 1854 | Alyssa Goodman | History | edx.org |
| Shakespeare and His World | Stephen Greenblatt | Story | edx.org |
| Rhetoric: The Art of Persuasive Writing | James Engell | Story | edx.org |
| Building your Screenplay | Abigail Docherty | Story | edx.org |
| Ancient Masterpieces of World Literature | Martin Puchner, David Damrosch | Story | edx.org |
| First Nights — Monteverdi's L'Orfeo | Thomas Forrest Kelly | Music | edx.org |
| Dante Alighieri: Science and poetry | Raffaele Giglio | Story | edx.org |
| Ancient Egyptian Art and Archaeology | Peter Der Manuelian | History | edx.org |
| Graphic Design Specialization | Michael Worthington | Design | coursera.org |
| Graphic Design Bootcamp | Derrick Mitchell | Design | udemy.com |

### About Section

**Profile image:** `https://jamesbuckhouse.com/images/James_Buckhouse_Profile_Pic.jpg`

**Bio text (verbatim with all inline links preserved):**

> "James Buckhouse believes story, art, and design can bend the arc of humanity's progress, if you do it right, and brings that idea into everything he does: from movies to startups to paintings to books and to [ballets](https://www.instagram.com/p/CG6c1ijpwIo/). As an artist, he has exhibited at the [Whitney Biennial](https://whitney.org/artists/t3540), the Solomon R. Guggenheim's Works & Process Series, The Institute of Contemporary Art in London, The Berkeley Art Museum, and the Dia Center. He has collaborated with leading choreographers at the New York City Ballet, San Francisco Ballet, LA Dance Project, Oregon Ballet Theatre, and Pennsylvania Ballet. As [Design Partner](https://www.sequoiacap.com/people/james-buckhouse/) at Sequoia, he [works with founders](https://www.sequoiacap.com/article/seven-questions-with-james-buckhouse/) from idea to IPO and beyond to help them design their companies, products, cultures, and businesses. Buckhouse got his start in [film](/film), lensing shots, crafting character arcs, and punching up story for the [Shrek, Madagascar, and Matrix](/film) series. He regularly guest lectures at [Harvard GSD](https://buckhouse.medium.com/the-structure-of-story-reading-list-fa8308a87860), Yale Architecture, [Stanford GSB](https://www.youtube.com/watch?v=hG5i05kRYmk), and d.school. Previously at Twitter, he authored [UX patents](https://read.cv/buckhouse) for emoji replies and social opinion polls."

**Social links:**

| Label | URL |
|---|---|
| LinkedIn | `https://www.linkedin.com/in/jamesbuckhouse/` |
| Twitter / X | `https://x.com/buckhouse` |
| Instagram | `https://www.instagram.com/buckhouse/` |
| Read.cv | `https://read.cv/buckhouse` |
| Delphi | `https://www.delphi.ai/buckhouse` |
| Newsletter | `https://jamesbuckhouse.substack.com/` |

Layout: 2-column at desktop (profile photo left, bio right), single column on mobile. Profile photo uses `border-radius: 24px` — Mac widget proportions, not a circle.

### 24-Hour Hotline Section

Content is entirely an `<iframe>` embed. The iframe container has a defined min-height and is styled as a frosted glass panel at desktop, full-bleed at mobile. No additional text copy in this section.

---

## 3. File Structure

```
index.html                     ← entry point, all sections in DOM (hidden/shown by router)
preview/
  server.js                    ← Bun static file server for local preview
src/
  css/
    tokens/
      colors.css               ← Big Sur palette (CSS custom properties)
      typography.css           ← FinancierDisplay + SF Pro system stack
      spacing.css              ← Apple-generous spacing scale
      radii.css                ← 8–28px radius system
      shadows.css              ← Soft diffuse elevation layers
      transitions.css          ← Spring cubic-bezier values
    base.css                   ← CSS reset + body + mesh pseudo-element
    main.css                   ← @import all tokens + components
    utilities.css              ← .reveal, .breathing, .parallax, .sr-only
    states.css                 ← hover, active, focus, loading skeleton
    components/
      navbar.css
      gallery-grid.css
      artwork-card.css
      film-card.css
      library-card.css
      filter-bar.css
      lightbox.css
      about.css
      hotline.css
      footer.css
  js/
    main.js                    ← init, route listener, scroll handler
    router.js                  ← hashchange → section show/hide + transitions
    Navbar.js                  ← hamburger toggle, active link state
    GalleryGrid.js             ← renders artwork cards, IntersectionObserver
    ArtworkCard.js             ← card element factory
    Lightbox.js                ← FLIP open/close, keyboard, focus trap
    FilmSection.js             ← renders intro paragraph + film cards
    FilmCard.js                ← film card factory
    LibrarySection.js          ← renders filter bar + cards, filter logic
    LibraryCard.js             ← library card factory (pill badge, not stripe)
    FilterBar.js               ← filter button row, active state
    AboutSection.js            ← bio render + social links
    HotlineEmbed.js            ← iframe mount + mobile container sizing
    Footer.js                  ← footer render
    data/
      artworks.js              ← 45 artwork objects { id, title, imageUrl, route }
      films.js                 ← 12 film objects { title, posterUrl, imdbUrl }
      library-items.js         ← all library items { title, description, instructor, category, url }
      artworks.test.js
      films.test.js
      library-items.test.js
```

---

## 4. Design System / Tokens

All tokens live in `src/css/tokens/` as CSS custom properties on `:root`.

### Colors — `tokens/colors.css`

```css
:root {
  /* ── Gradient mesh (Big Sur dusk) ────────────────────────── */
  --bg-mesh-start:      #f5e6c8;   /* warm peach, Big Sur hillside */
  --bg-mesh-mid:        #c9bde0;   /* soft lavender */
  --bg-mesh-end:        #2d4a6e;   /* deep coastal blue */

  /* ── Surfaces ─────────────────────────────────────────────── */
  --surface-card:       #fffcf8;   /* warm white — solid, not frosted */
  --surface-nav:        rgba(250, 247, 243, 0.85);   /* navbar only: frosted */
  --surface-lightbox:   rgba(255, 255, 255, 0.92);   /* lightbox panel: frosted */
  --surface-overlay:    rgba(0, 0, 0, 0.55);         /* lightbox backdrop */

  /* ── Text ─────────────────────────────────────────────────── */
  --text-primary:       #1e1a14;   /* warm near-black (tinted toward ochre) */
  --text-secondary:     #6b6257;   /* warm mid-grey */
  --text-tertiary:      #a09587;   /* warm light metadata */
  --text-on-dark:       #f5f3ef;   /* for dark backgrounds */

  /* ── Accents ──────────────────────────────────────────────── */
  --accent-gold:        #c8864a;   /* Big Sur amber — slightly deeper than brief */
  --accent-blue:        #4a7fa8;   /* coastal blue */
  --accent-lavender:    #8b6bb1;   /* lavender accent */

  /* ── Borders ─────────────────────────────────────────────── */
  --border-subtle:      rgba(0, 0, 0, 0.07);
  --border-card:        rgba(180, 160, 140, 0.18);   /* warm tint, not cold grey */
  --border-nav:         rgba(255, 255, 255, 0.40);

  /* ── Category accent colors (library) — preserved from original ── */
  --category-history:      #d45800;
  --category-science:      #007fb5;
  --category-biology:      #00a85a;
  --category-story:        #b5006a;
  --category-architecture: #6b00cc;
  --category-design:       #cc003e;
  --category-art:          #c47700;
  --category-tools:        #4a4a4a;
  --category-film:         #4500cc;
  --category-typography:   #009ea8;
  --category-anatomy:      #cc0054;
  --category-color:        #009940;
}
```

Note: All neutrals are **warm-tinted** (shifted toward `#1e1a14` brown-black rather than the Apple cold `#1d1d1f`). The category accent colors are the original site values, desaturated ~15% to coexist with the Big Sur warmth without clashing.

### Typography — `tokens/typography.css`

The critique identified Inter as the AI monoculture fallback. The resolution: **FinancierDisplay is kept** for hero headings and section headings — it was always the brand anchor of the original site and looks precisely at home rendered large against the Big Sur gradient. Body text falls back through the actual system UI stack.

```css
:root {
  /* ── Font families ─────────────────────────────────────────── */
  --font-display:  "FinancierDisplay", "Georgia", serif;
  --font-ui:       "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont,
                   "Segoe UI", Roboto, sans-serif;
  --font-mono:     "SF Mono", "Menlo", monospace;

  /* ── Type scale ───────────────────────────────────────────── */
  --text-hero:     clamp(3rem, 7vw, 6rem);      /* weight 300 — FinancierDisplay */
  --text-section:  clamp(1.75rem, 3vw, 2.5rem); /* weight 300 — FinancierDisplay */
  --text-h3:       1.125rem;                    /* 18px, weight 600, --font-ui */
  --text-body:     1rem;                        /* 16px, weight 400 */
  --text-caption:  0.875rem;                    /* 14px */
  --text-nav:      0.9375rem;                   /* 15px, weight 500 */
  --text-tag:      0.8125rem;                   /* 13px, weight 500 */

  /* ── Tracking ─────────────────────────────────────────────── */
  --tracking-display: -0.02em;
  --tracking-tight:   -0.01em;

  /* ── Line heights ─────────────────────────────────────────── */
  --leading-tight:   1.1;
  --leading-normal:  1.5;
  --leading-relaxed: 1.7;
}
```

FinancierDisplay is loaded from the original jamesbuckhouse.com CDN path if available (`@font-face` with the same URL the original site uses), or gracefully falls back to Georgia — both are elegant editorial serifs.

### Spacing — `tokens/spacing.css`

```css
:root {
  --sp-xs:      0.25rem;   /*  4px */
  --sp-sm:      0.5rem;    /*  8px */
  --sp-md:      1rem;      /* 16px */
  --sp-lg:      1.5rem;    /* 24px */
  --sp-xl:      2rem;      /* 32px */
  --sp-2xl:     3rem;      /* 48px */
  --sp-3xl:     5rem;      /* 80px */
  --sp-section: 7.5rem;    /* 120px — Apple product-page breathing room */

  --container:  1200px;
  --nav-height: 60px;
  --card-gap:   24px;
}
```

### Radii — `tokens/radii.css`

```css
:root {
  --r-sm:    8px;     /* thumbnails inside cards */
  --r-md:    16px;    /* cards */
  --r-lg:    24px;    /* large panels, lightbox, profile photo */
  --r-xl:    28px;    /* hero containers */
  --r-pill:  9999px;  /* tags, category badges, social links */
  --r-nav:   10px;    /* nav hover pills */
}
```

### Shadows — `tokens/shadows.css`

```css
:root {
  --shadow-card:   0 2px 12px rgba(60,40,20,0.06), 0 1px 3px rgba(60,40,20,0.04);
  --shadow-hover:  0 16px 40px rgba(60,40,20,0.11), 0 4px 12px rgba(60,40,20,0.07);
  --shadow-nav:    0 1px 20px rgba(60,40,20,0.09);
  --shadow-modal:  0 40px 80px rgba(0,0,0,0.20), 0 8px 24px rgba(0,0,0,0.10);
  --shadow-badge:  0 1px 4px rgba(0,0,0,0.12);
}
```

All shadow colors are warm-tinted (`rgb(60,40,20,...)`) rather than neutral black, matching the overall palette warmth.

### Transitions — `tokens/transitions.css`

```css
:root {
  --ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out:     cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in:      cubic-bezier(0.4, 0, 1, 1);
  --ease-std:     ease;

  --dur-fast:     150ms;
  --dur-normal:   300ms;
  --dur-slow:     500ms;
  --dur-breath:   10s;
  --dur-film-breath: 9s;
  --dur-mesh:     32s;
  --dur-route:    300ms;
}
```

---

## 5. Component Specifications

### Navbar

**Purpose:** Fixed top navigation bar. Provides section routing and external newsletter link.

**Implementation:**
- `position: fixed; top: 0; left: 0; right: 0; height: var(--nav-height); z-index: 100`
- Background: `var(--surface-nav)` with `backdrop-filter: blur(20px) saturate(180%)` — glass restricted to this component
- Border-bottom: `1px solid var(--border-nav)`
- Shadow: `var(--shadow-nav)`
- Left: nav links with emoji prefix, `font-family: var(--font-ui)`, `font-size: var(--text-nav)`
- Right: Newsletter link as pill button with `border-radius: var(--r-nav)`, `background: var(--border-subtle)` at rest

**Interaction states:**
- **Hover:** Background pill `rgba(0,0,0,0.05)` appears behind the link, `border-radius: var(--r-nav)`, `transition: var(--dur-fast) var(--ease-out)`
- **Active (current route):** Link gets `font-weight: 600` and slightly warmer text color
- **Mobile hamburger:** At `≤768px`, nav links collapse. Hamburger icon (3-bar → X) animates at `200ms ease`. Clicking opens a full-width overlay drawer sliding down from the navbar. The drawer is a column of the same nav links, larger touch targets (`48px` min-height each). Clicking a link closes the drawer.
- **Focus visible:** `outline: 2px solid var(--accent-blue)` with `outline-offset: 3px`

### Artwork Card (Gallery Grid)

**Purpose:** Displays a single artwork thumbnail in the 3-column gallery. Clicking opens the lightbox.

**Implementation:**
- Container: `border-radius: var(--r-md)`, `overflow: hidden`, `background: var(--surface-card)`, `border: 1px solid var(--border-card)`, `box-shadow: var(--shadow-card)`
- Image: `width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--r-md)`
- No frosted glass on cards — the art is the content, the card is the frame
- Title: absolutely positioned at bottom of card, `padding: var(--sp-md)`, white text with `text-shadow` for legibility, hidden at rest, fades in on hover (`opacity: 0 → 1, 200ms ease`)

**Loading state:** Before the image loads, the card shows a shimmer skeleton:
```css
.artwork-card.loading .card-img {
  background: linear-gradient(90deg, #f0ece6 25%, #e8e2da 50%, #f0ece6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }
```

**Interaction states:**
- **Breathing (idle):** `animation: breathe var(--dur-breath) ease-in-out infinite` — scale 1.0 → 1.03 → 1.0. Applied to the `<img>` element directly, not the container, so it cannot trigger layout recalculation.
- **Hover:** `transform: translateY(-4px); box-shadow: var(--shadow-hover)`. Transition: `var(--dur-slow) var(--ease-spring)` for transform, `var(--dur-normal) ease` for shadow. Breathing pauses on hover (`:hover` resets `animation-play-state: paused`).
- **Scroll reveal:** IntersectionObserver fires when card enters viewport. Card transitions `opacity: 0→1` + `translateY(20px→0)` in `400ms ease-out`. Each card is staggered `itemIndex * 60ms`.
- **`prefers-reduced-motion`:** Breathing, parallax, and stagger are all disabled. Hover lift is kept (it is not time-based).

### Lightbox

**Purpose:** Full-screen artwork view opened from a gallery card click.

**FLIP + breathing coordination — critical fix:**
When the user clicks a card, the sequence is:
1. Immediately set `animation-play-state: paused` on the clicked card and reset `transform: scale(1.0)` with a forced style flush
2. Measure the card's `getBoundingClientRect()` — guaranteed scale=1.0 at time of measurement
3. Execute FLIP: animate the lightbox panel from the card's bounds to full-center using `transform` only
4. On lightbox close, reverse FLIP, then restore `animation-play-state: running` once the card is back in view

This sequence eliminates the jank described in the critique where a mid-breath scale measurement would cause the lightbox to expand from a wrong origin.

**Implementation:**
- Backdrop: `position: fixed; inset: 0; background: var(--surface-overlay); backdrop-filter: blur(40px) saturate(200%)`
- Panel: `border-radius: var(--r-lg); background: var(--surface-lightbox); box-shadow: var(--shadow-modal)`
- FLIP easing: `var(--ease-spring)` on open (spring overshoot), `var(--ease-out)` on close
- Keyboard: `Escape` closes. `ArrowLeft` / `ArrowRight` navigate between artworks.
- Focus trap: on open, focus moves to the close button. Tab cycles within the lightbox.
- `aria-modal="true"` on panel. `role="dialog"`. `aria-label` = artwork title.

### Film Card

**Purpose:** Film poster with title and IMDB link.

**Implementation:**
- Grid: 4 columns desktop (`repeat(4, 1fr)`), 3 at tablet, 2 at mobile
- Card: `border-radius: var(--r-md); overflow: hidden; background: var(--surface-card); box-shadow: var(--shadow-card)`
- Poster image: portrait aspect ratio `2/3`, `object-fit: cover`, `border-radius: var(--r-sm)` inset
- Title: `font-family: var(--font-ui); font-size: var(--text-h3); font-weight: 600; margin-top: var(--sp-md)`
- Link: full card is `<a>`, `target="_blank" rel="noopener"`

**Loading state:** Same shimmer skeleton pattern as artwork cards, preserving the `2/3` aspect ratio box.

**Interaction states:**
- Breathing: `animation: breathe var(--dur-film-breath) ease-in-out infinite` on poster `<img>`, 9s to differ from gallery's 10s
- Hover: spring lift `translateY(-4px)` + shadow expansion, same spring easing as artwork cards

### Library Card

**Purpose:** Displays a curated course or resource: title, description, instructor, and a "Learn More" link. Text-only, no image.

**Category indicator — anti-pattern fix:**
The brief spec'd a `border-left: 3px solid` stripe. Per the critique, this is the single most AI-recognizable card pattern. The final implementation uses a **small pill badge in the upper-right corner** of the card: the category name in `--text-tag` size, `background: rgba(categoryColor, 0.12)`, `color: categoryColor`, `border-radius: var(--r-pill)`, `padding: 2px 8px`. It is visible but not dominant.

**Implementation:**
- Card: `background: var(--surface-card); border-radius: var(--r-md); border: 1px solid var(--border-card); box-shadow: var(--shadow-card); padding: var(--sp-xl)`
- No frosted glass — text cards have no image content that benefits from translucency
- Position: `relative` for the badge
- Badge: `position: absolute; top: var(--sp-md); right: var(--sp-md)`
- Title: `font-family: var(--font-display); font-size: var(--text-h3); font-weight: 300; letter-spacing: var(--tracking-tight)`
- Description: `font-size: var(--text-caption); line-height: var(--leading-relaxed); color: var(--text-secondary)`
- Instructor: `font-size: var(--text-tag); color: var(--text-tertiary)`
- "Learn More" link: pill button `border-radius: var(--r-pill); background: rgba(categoryColor, 0.10); color: var(--accent-gold); font-size: var(--text-caption); font-weight: 500; padding: 4px 12px`

**Empty state:**
```html
<div class="library-empty" hidden>
  <p>Nothing here yet — <a href="#" class="filter-clear">clear filter</a></p>
</div>
```
Shown when the active filter returns 0 items.

**Interaction states:**
- Hover: mild `translateY(-2px)` + shadow — restrained because this is a text card, not an image card
- Loading: shimmer on the title and description lines (multi-line skeleton bars)

### Filter Bar

**Purpose:** Horizontal scrollable row of category pills for filtering library items.

**Implementation:**
- Container: `display: flex; gap: var(--sp-sm); overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; scrollbar-width: none`
- Each button: `border-radius: var(--r-pill); font-size: var(--text-tag); font-weight: 500; white-space: nowrap; padding: 6px 14px; cursor: pointer; border: none`
- Inactive: `background: rgba(0,0,0,0.05); color: var(--text-secondary)`
- Active: `background: var(--surface-card); color: var(--text-primary); box-shadow: var(--shadow-badge)` + `border: 1px solid var(--border-card)`
- `aria-pressed="true/false"` managed by JS

**Interaction states:**
- Hover (inactive): `background: rgba(0,0,0,0.08)` — subtle, `150ms ease`
- Transition on active state change: `background 200ms ease, box-shadow 200ms ease`

### About Section

**Purpose:** James Buckhouse's biography, profile photo, and social links.

**Layout:** 2-column at desktop — photo left (40%), bio right (60%), `gap: var(--sp-3xl)`. Single column on mobile, photo centered above bio.

**Implementation:**
- Profile photo: `border-radius: var(--r-lg)` (24px — Mac widget proportions, not a circle), `box-shadow: var(--shadow-card)`, `max-width: 320px`
- Bio text: `font-family: var(--font-ui); font-size: 1.0625rem; line-height: var(--leading-relaxed); color: var(--text-primary)` — inline `<a>` links use `color: var(--accent-blue); text-decoration: underline`
- Social links: row of pill buttons, `border-radius: var(--r-pill)`, `background: var(--surface-card)`, `border: 1px solid var(--border-card)`, icon (SVG inline) + label text, `gap: var(--sp-sm)`, wraps on mobile

**Loading state:** Profile image uses the shimmer skeleton on `aspect-ratio: 1` container until loaded.

### Hotline Embed (24-Hour Hotline)

**Purpose:** Iframe embed of the design hotline external content.

**Implementation:**
- Container: `border-radius: var(--r-lg); overflow: hidden; background: var(--surface-card); box-shadow: var(--shadow-card)`
- Iframe: `width: 100%; min-height: 600px; border: none; display: block`
- Mobile: `border-radius: 0; min-height: 80vh` — full-bleed at small screens
- Loading fallback: if iframe fails to load, a centered message with a direct link to the external URL

### Hero Background (Gradient Mesh)

**Purpose:** The ambient drifting gradient that fills the page behind all content, evoking the Big Sur wallpaper.

**Compositor-safe implementation — anti-pattern fix:**
The brief spec'd `@keyframes meshDrift { background-position: 0% 50% → 100% 50% }`. This triggers paint every frame on Safari/Firefox. The final implementation uses a `::before` pseudo-element on `<body>` that is large (300% width) and drifts via `transform: translateX()`:

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  width: 300%;
  left: -100%;
  background: linear-gradient(
    135deg,
    var(--bg-mesh-start) 0%,
    var(--bg-mesh-mid) 40%,
    var(--bg-mesh-end) 80%,
    var(--bg-mesh-start) 100%
  );
  animation: meshDrift var(--dur-mesh) ease infinite;
  will-change: transform;
  z-index: -1;
}

@keyframes meshDrift {
  0%   { transform: translateX(0); }
  50%  { transform: translateX(33.33%); }
  100% { transform: translateX(0); }
}
```

`transform` runs entirely on the compositor — no paint, no layout.

### 404 / Not-Found State

When the hash router receives an unrecognized route, it renders a simple centered message:

```html
<section class="not-found">
  <h1>Nothing here.</h1>
  <a href="#/">← Back to the gallery</a>
</section>
```

No special styling beyond the standard section container. The gradient mesh background is still visible. The heading uses `--font-display` (FinancierDisplay) for tonal consistency.

---

## 6. Implementation Priority Order

### P0 — Foundation

Everything that must exist before any component can be rendered correctly.

1. **Token files** — `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing.css`, `tokens/radii.css`, `tokens/shadows.css`, `tokens/transitions.css`
2. **`base.css`** — CSS reset, `box-sizing`, `body` styles, gradient mesh `::before` pseudo-element (compositor-safe `transform` animation)
3. **`main.css`** — `@import` all tokens and component files in order
4. **`index.html`** — document structure, `<link>` tags, `<section>` shells for all 5 routes, `<nav>` skeleton
5. **`router.js`** — `hashchange` listener, section show/hide, route transition crossfade
6. **Data files** — `artworks.js`, `films.js`, `library-items.js` with all real content

### P1 — Core Components

The main content-bearing elements of the site.

7. **`GalleryGrid.js` + `artwork-card.css`** — renders 45 artwork cards in 3-column grid, shimmer loading states, IntersectionObserver stagger reveal
8. **`Navbar.js` + `navbar.css`** — frosted glass navbar, active route state, hamburger for mobile
9. **`FilmSection.js` + `film-card.css`** — intro paragraph + 12 film cards, 4-column grid, loading skeletons
10. **`AboutSection.js` + `about.css`** — 2-column layout, profile photo, bio with inline links, social pills

### P2 — Secondary Components

11. **`Lightbox.js` + `lightbox.css`** — FLIP animation with breathing-pause coordination, keyboard nav, focus trap
12. **`LibrarySection.js` + `LibraryCard.js` + `library-card.css`** — filter logic, pill badge category indicator, empty state
13. **`FilterBar.js` + `filter-bar.css`** — 22 category pills, `aria-pressed`, empty-filter trigger
14. **`HotlineEmbed.js` + `hotline.css`** — iframe container, mobile sizing, failure fallback
15. **404 state** in `router.js` — unrecognized hash → not-found section

### P3 — Polish

16. **Breathing animations** on artwork and film cards — 10s / 9s `breathe` keyframes on `<img>` elements
17. **Scroll parallax** — `requestAnimationFrame` loop translating hero background at 0.4× scroll rate
18. **Route transition crossfades** — `opacity` + `scale(0.98→1.0)` on section enter
19. **Hover spring physics** — `var(--ease-spring)` on card `translateY(-4px)` and shadow expansion
20. **`prefers-reduced-motion` guard** — single `@media` block that disables breathing, mesh drift, parallax, stagger delays, and spring easing (replaced with `ease` at `150ms`)
21. **`backdrop-filter` dynamic loading** — IntersectionObserver adds/removes `backdrop-filter` class on artwork cards as they enter/leave viewport, keeping GPU load bounded

---

## 7. Dev Server & Preview

Bun's built-in static file server handles local preview:

```sh
bun preview/server.js
```

`server.js` serves `index.html` for all routes and static assets from `src/`. The site runs fully client-side with hash routing (`#/`, `#/film`, etc.) — no backend required, no build step.

```sh
# Install (no dependencies beyond Bun)
bun install

# Preview at http://localhost:3000
bun preview/server.js
```

For tests:

```sh
bun test           # all tests
bun test:coverage  # with coverage
```

Data file tests verify that all 45 artwork objects have `id`, `title`, `imageUrl`, and `route` fields; all 12 film objects have `title`, `posterUrl`, and `imdbUrl`; and all library items have `title`, `description`, `instructor`, `category`, and `url`.

---

## Appendix: Critique Resolution Summary

| Issue | Critique Severity | Resolution |
|---|---|---|
| `border-left: 3px` stripe on library cards | P0 — BAN 1 violation | Replaced with pill badge in upper-right corner |
| `"Inter"` in font stack | P0 — banned reflex font | Removed; FinancierDisplay for headings, system UI stack for body |
| `background-position` in `@keyframes meshDrift` | P0 — breaks 60fps | Reimplemented as `transform: translateX()` on wide `::before` pseudo-element |
| FLIP + breathing animation coordination | P1 — lightbox stutter | Pause breathing + force scale=1.0 before FLIP measurement |
| Missing: loading states (45 images) | P1 — blank squares on first load | Shimmer skeleton on all `<img>` containers |
| Missing: empty filter state | P1 — undefined UI | "Nothing here yet — clear filter" message with reset link |
| Missing: 404 route | P1 — unhandled route | Simple centered message with home link, rendered by router |
| Missing: mobile hamburger spec | P1 — potentially broken mobile nav | Full-width overlay drawer, 200ms ease, 48px touch targets |
| Missing: hotline iframe container | P1 — unstyled iframe on mobile | `border-radius: 0; min-height: 80vh` on mobile |
| Frosted glass on every surface | Aesthetic — wallpaper effect | Restricted to navbar and lightbox backdrop only |
| Cold neutrals in warm palette | Aesthetic — color incoherence | All neutrals warm-tinted toward `#1e1a14` |
| Film grid "3-4 columns" not a spec | Spec ambiguity | Committed: 4 desktop, 3 tablet, 2 mobile |
| About "centered or 2-column" not a spec | Spec ambiguity | Committed: 2-column desktop, 1-column mobile |
| Accent colors ~30-40% muted vs. original | Aesthetic — too subtle | Category colors kept closer to originals, desaturated ~15% only |
