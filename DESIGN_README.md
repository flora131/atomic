# DESIGN_README.md — Big Sur Art Theme for jamesbuckhouse.com

> A complete design specification for rebuilding [jamesbuckhouse.com](https://jamesbuckhouse.com/) with a macOS Big Sur–inspired aesthetic. Every piece of original content — all 45 artworks, 12 film posters, 64 library resources, the Delphi hotline embed, and the About bio — is preserved exactly. The transformation is visual, not editorial.

---

## 1. Project Outcomes

### What "Big Sur Art Theme" Means

The macOS Big Sur design language is defined by three pillars: **frosted glass surfaces** (backdrop-filter blur + saturate on translucent backgrounds), **generous border radii** (16px windows, 20px hero images), and **layered depth** (multi-layer box shadows that create physical-feeling elevation). Applied to an art portfolio, this means the artwork is framed like gallery windows overlooking the Pacific — warm, luminous, atmospheric.

### How It's Achieved

| Big Sur Principle | Implementation |
|---|---|
| Frosted glass | `backdrop-filter: blur(20px) saturate(180%)` on navbar; `blur(12px) saturate(150%)` on card surfaces; `blur(40px) saturate(200%)` on lightbox overlay |
| Generous radii | Cards at 16px, images within cards at 12px, hero/profile images at 20px, CTAs at pill (9999px) |
| Layered depth | Dual-layer box shadows (`shadow-sm` through `shadow-xl`) replace the original single-shadow system |
| Coastal palette | Ocean blues (#1B3A4B → #D4E6F0) layered over the original warm neutrals (#E8E5E3, #F8F6F3) |
| Lift-not-scale hovers | `translateY(-4px)` replaces `scale(1.02)` to avoid distorting artwork |
| Typography refinement | Section headings drop uppercase; body line-height increases to 1.65; card titles left-align at 18px |

### What's Preserved From the Original Site

- **All 58 images** at their real URLs from `https://jamesbuckhouse.com/`
- **All 45 artwork cards** with titles, routes, and image content
- **All 12 film poster cards** with titles and IMDB links
- **All 64 library resources** with titles, instructors, descriptions, and external links
- **The 24-Hour Hotline** Delphi.ai iframe embed
- **The About section** with profile photo, full biographical text (including inline links), and all 6 social links
- **Navigation structure**: Art, 24-Hour Hotline, Library, Film, Buckhouse, Newsletter
- **Hash routing**: `#/`, `#/design`, `#/library`, `#/film`, `#/about`, `#/art/{1-45}`
- **The 1 video asset**: `mayron_install.mp4` on Art card #1

---

## 2. Content Integration Plan

### CRITICAL RULE: Real Images Only

**Every artwork card, film poster, and profile photo MUST use an `<img>` tag with the real image URL from `https://jamesbuckhouse.com/`.** There are NO placeholders, NO colored `<div>`s substituting for images, NO `background-color` stand-ins. If an implementation shows a colored rectangle where an artwork should be, it is WRONG.

### 2.1 Art Gallery Images (45 total)

Each artwork card renders as:

```html
<a href="#/art/{N}" class="artwork-card-link">
  <div class="artwork-card-sizer">
    <img src="REAL_URL" alt="REAL_ALT" loading="lazy" decoding="async">
  </div>
  <p class="artwork-card-title">TITLE</p>
</a>
```

| # | Title | `<img>` Tag |
|---|---|---|
| 1 | Maryon Park Installation View | `<img src="https://jamesbuckhouse.com/images/image_66.jpg" alt="Maryon Park Installation View" loading="lazy" decoding="async">` |
| 2 | Maryon Park (side view) | `<img src="https://jamesbuckhouse.com/images/image_67.jpg" alt="Maryon Park (side view)" loading="lazy" decoding="async">` |
| 3 | Maryon Park Detail | `<img src="https://jamesbuckhouse.com/images/image_65.jpg" alt="Maryon Park Detail" loading="lazy" decoding="async">` |
| 4 | Big Sur | `<img src="https://jamesbuckhouse.com/images/image_1.jpg" alt="Big Sur" loading="lazy" decoding="async">` |
| 5 | Double Exposure | `<img src="https://jamesbuckhouse.com/images/image_3.jpg" alt="Double Exposure" loading="lazy" decoding="async">` |
| 6 | Conservatory of Flowers | `<img src="https://jamesbuckhouse.com/images/image_4.jpg" alt="Conservatory of Flowers" loading="lazy" decoding="async">` |
| 7 | Conservatory of Flowers II | `<img src="https://jamesbuckhouse.com/images/image_61.jpg" alt="Conservatory of Flowers II" loading="lazy" decoding="async">` |
| 8 | Donner und Blitz (Hotel) | `<img src="https://jamesbuckhouse.com/images/image_10.jpg" alt="Donner und Blitz (Hotel)" loading="lazy" decoding="async">` |
| 9 | Donner und Blitz (Hotel) Side View | `<img src="https://jamesbuckhouse.com/images/image_63.jpg" alt="Donner und Blitz (Hotel) Side View" loading="lazy" decoding="async">` |
| 10 | Donner und Blitz (Collapsed House) | `<img src="https://jamesbuckhouse.com/images/image_38.jpg" alt="Donner und Blitz (Collapsed House)" loading="lazy" decoding="async">` |
| 11 | Wild Kigers | `<img src="https://jamesbuckhouse.com/images/image_52.jpg" alt="Wild Kigers" loading="lazy" decoding="async">` |
| 12 | Homeward Abstraction | `<img src="https://jamesbuckhouse.com/images/image_9.jpg" alt="Homeward Abstraction" loading="lazy" decoding="async">` |
| 13 | AR Paris Dance (Sketch) | `<img src="https://jamesbuckhouse.com/images/image_6.jpg" alt="AR Paris Dance (Sketch)" loading="lazy" decoding="async">` |
| 14 | AR Paris Dance (Sketch) II | `<img src="https://jamesbuckhouse.com/images/image_42.jpg" alt="AR Paris Dance (Sketch) II" loading="lazy" decoding="async">` |
| 15 | Bridge of Sighs | `<img src="https://jamesbuckhouse.com/images/image_5.jpg" alt="Bridge of Sighs" loading="lazy" decoding="async">` |
| 16 | Fixpencil | `<img src="https://jamesbuckhouse.com/images/image_7.jpg" alt="Fixpencil" loading="lazy" decoding="async">` |
| 17 | Ocean Sketch | `<img src="https://jamesbuckhouse.com/images/image_8.jpg" alt="Ocean Sketch" loading="lazy" decoding="async">` |
| 18 | Ocean Watercolor | `<img src="https://jamesbuckhouse.com/images/image_58.jpg" alt="Ocean Watercolor" loading="lazy" decoding="async">` |
| 19 | Imaginary Wave | `<img src="https://jamesbuckhouse.com/images/image_59.jpg" alt="Imaginary Wave" loading="lazy" decoding="async">` |
| 20 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_27.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 21 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_28.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 22 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_29.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 23 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_30.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 24 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_32.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 25 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_57.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 26 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_56.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 27 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_37.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 28 | Homeward Ballet (Three Graces) | `<img src="https://jamesbuckhouse.com/images/image_41.jpg" alt="Homeward Ballet (Three Graces)" loading="lazy" decoding="async">` |
| 29 | Homeward Ballet | `<img src="https://jamesbuckhouse.com/images/image_46.jpg" alt="Homeward Ballet" loading="lazy" decoding="async">` |
| 30 | Homeward Ballet Costumes | `<img src="https://jamesbuckhouse.com/images/image_36.jpg" alt="Homeward Ballet Costumes" loading="lazy" decoding="async">` |
| 31 | Homeward Ballet Costumes (sketch) | `<img src="https://jamesbuckhouse.com/images/image_34.jpg" alt="Homeward Ballet Costumes (sketch)" loading="lazy" decoding="async">` |
| 32 | Video Installation | `<img src="https://jamesbuckhouse.com/images/image_33.jpg" alt="Video Installation" loading="lazy" decoding="async">` |
| 33 | Sensorium Installation | `<img src="https://jamesbuckhouse.com/images/image_44.jpg" alt="Sensorium Installation" loading="lazy" decoding="async">` |
| 34 | Sensorium Installation | `<img src="https://jamesbuckhouse.com/images/image_45.jpg" alt="Sensorium Installation" loading="lazy" decoding="async">` |
| 35 | Hand on Glass | `<img src="https://jamesbuckhouse.com/images/image_39.jpg" alt="Hand on Glass" loading="lazy" decoding="async">` |
| 36 | Friends and Strangers | `<img src="https://jamesbuckhouse.com/images/image_40.jpg" alt="Friends and Strangers" loading="lazy" decoding="async">` |
| 37 | Friends and Strangers | `<img src="https://jamesbuckhouse.com/images/image_60.jpg" alt="Friends and Strangers" loading="lazy" decoding="async">` |
| 38 | Sketchbook | `<img src="https://jamesbuckhouse.com/images/image_43.jpg" alt="Sketchbook" loading="lazy" decoding="async">` |
| 39 | Oil Studies | `<img src="https://jamesbuckhouse.com/images/image_47.jpg" alt="Oil Studies" loading="lazy" decoding="async">` |
| 40 | Working Rope | `<img src="https://jamesbuckhouse.com/images/image_48.jpg" alt="Working Rope" loading="lazy" decoding="async">` |
| 41 | Aleatoric Rope | `<img src="https://jamesbuckhouse.com/images/image_53.jpg" alt="Aleatoric Rope" loading="lazy" decoding="async">` |
| 42 | Taut Rope | `<img src="https://jamesbuckhouse.com/images/image_55.jpg" alt="Taut Rope" loading="lazy" decoding="async">` |
| 43 | Bird and Fly | `<img src="https://jamesbuckhouse.com/images/image_51.jpg" alt="Bird and Fly" loading="lazy" decoding="async">` |
| 44 | Half Moon Bay | `<img src="https://jamesbuckhouse.com/images/image_62.jpg" alt="Half Moon Bay" loading="lazy" decoding="async">` |
| 45 | Drawing Table | `<img src="https://jamesbuckhouse.com/images/image_54.jpg" alt="Drawing Table" loading="lazy" decoding="async">` |

**Card #1 special case:** Also includes a `<video>` element:
```html
<video src="https://jamesbuckhouse.com/images/video/mayron_install.mp4" muted autoplay loop playsinline></video>
```

### 2.2 Film Poster Images (12 total)

Each film card renders as:

```html
<a href="IMDB_URL" class="film-card" target="_blank" rel="noopener noreferrer">
  <div class="film-card-image">
    <img src="REAL_URL" alt="TITLE poster" loading="lazy" decoding="async">
  </div>
  <h3 class="film-card-title">TITLE</h3>
</a>
```

| # | Title | `<img>` Tag | IMDB Link |
|---|---|---|---|
| 1 | Carmen | `<img src="https://jamesbuckhouse.com/images/film-posters/carmen.jpg" alt="Carmen poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt6875952/ |
| 2 | Matrix Revolutions | `<img src="https://jamesbuckhouse.com/images/film-posters/matrix.jpg" alt="Matrix Revolutions poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0242653/ |
| 3 | Monsters vs. Aliens | `<img src="https://jamesbuckhouse.com/images/film-posters/mva.jpg" alt="Monsters vs. Aliens poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0892782/ |
| 4 | Madagascar Escape 2 Africa | `<img src="https://jamesbuckhouse.com/images/film-posters/mad2.jpg" alt="Madagascar Escape 2 Africa poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0479952 |
| 5 | Madagascar | `<img src="https://jamesbuckhouse.com/images/film-posters/mad.jpg" alt="Madagascar poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0351283 |
| 6 | Penguins Christmas Caper | `<img src="https://jamesbuckhouse.com/images/film-posters/caper.jpg" alt="Penguins Christmas Caper poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0484439 |
| 7 | Shrek the Halls | `<img src="https://jamesbuckhouse.com/images/film-posters/halls.jpg" alt="Shrek the Halls poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0897387 |
| 8 | Shrek the Third | `<img src="https://jamesbuckhouse.com/images/film-posters/shrek3.jpg" alt="Shrek the Third poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0413267 |
| 9 | Shrek 2 | `<img src="https://jamesbuckhouse.com/images/film-posters/shrek2.jpg" alt="Shrek 2 poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0298148 |
| 10 | Shrek | `<img src="https://jamesbuckhouse.com/images/film-posters/shrek.jpg" alt="Shrek poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0126029 |
| 11 | Antz | `<img src="https://jamesbuckhouse.com/images/film-posters/antz.jpg" alt="Antz poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0120587 |
| 12 | The Peacemaker | `<img src="https://jamesbuckhouse.com/images/film-posters/peacemaker.jpg" alt="The Peacemaker poster" loading="lazy" decoding="async">` | https://www.imdb.com/title/tt0119874 |

### 2.3 About Section Image (1 total)

```html
<img
  src="https://jamesbuckhouse.com/images/James_Buckhouse_Profile_Pic.jpg"
  alt="James Buckhouse"
  class="about-image"
  loading="eager"
  decoding="async"
>
```

### 2.4 Text Content Mapping

| Original Section | Content Source | Maps To Component |
|---|---|---|
| Navigation (6 items) | Nav links with emoji prefixes | `<nav class="navbar">` — Art, 24-Hour Hotline, Library, Film, Buckhouse, Newsletter (external) |
| Art Gallery (45 cards) | `#/` route, 3-column grid | `<section class="art-section">` → `<div class="gallery-grid">` → 45 `<a class="artwork-card-link">` |
| 24-Hour Hotline | `#/design` route, Delphi iframe | `<section class="hotline-section">` → `<iframe src="https://www.delphi.ai/buckhouse">` |
| Library heading | "Library" (FinancierDisplay, 64px) | `<h1 class="section-heading">Library</h1>` |
| Library intro | "I put together this small athenaeum..." | `<p class="library-intro">` with suggestion link to Airtable form |
| Library filters (22 categories) | All, AI, Anatomy, Architecture, Art, Biology, Buckhouse, Color, Computer Science, Dance, Design, Drawing, Film, Game Design, History, Jobs, Music, Philosophy, Science, Story, Tools, Typography | `<div class="filter-bar">` → 22 `<button class="filter-btn">` |
| Library cards (64 items) | Course title, description, instructor, prerequisites, URL | `<div class="library-grid">` → 64 `<a class="timeline-item">` |
| Film intro | "I got my start lensing shots..." (mentions Shrek, Madagascar, Matrix) | `<p class="film-intro">` |
| Film posters (12 cards) | Poster image + title, links to IMDB | `<div class="film-grid">` → 12 `<a class="film-card">` |
| About photo | Profile image (1778x1000) | `<img class="about-image">` |
| About bio | 4 paragraphs with inline links (Whitney, Sequoia, Harvard, etc.) | `<div class="about-text">` → `<p>` elements with `<a>` inline links |
| Social links (6) | LinkedIn, Twitter, Instagram, Read.cv, Delphi, Newsletter | `<div class="social-links">` → 6 `<a class="social-link">` with Font Awesome icons |

---

## 3. File Structure

```
src/
├── styles/
│   ├── tokens.css            # Design tokens (CSS custom properties)
│   ├── base.css              # Reset, body, typography defaults
│   ├── components/
│   │   ├── navbar.css        # Navbar with frosted glass
│   │   ├── artwork-card.css  # Art gallery cards (img-based, NOT colored divs)
│   │   ├── gallery-grid.css  # Responsive 3-column grid
│   │   ├── library-card.css  # Library timeline items
│   │   ├── filter-bar.css    # Category filter buttons
│   │   ├── film-card.css     # Film poster cards
│   │   ├── about.css         # About section (photo + bio + social)
│   │   ├── lightbox.css      # Artwork detail lightbox modal
│   │   └── footer.css        # New mist-fade footer
│   ├── utilities.css         # Utility classes (visually-hidden, glass, etc.)
│   └── states.css            # Hover, focus-visible, active, loading states
├── components/
│   ├── Navbar.ts             # Navigation with hash routing
│   ├── GalleryGrid.ts        # Art gallery grid (renders <img> tags)
│   ├── ArtworkCard.ts        # Single artwork card component
│   ├── Lightbox.ts           # Fullscreen artwork detail view
│   ├── HotlineEmbed.ts       # Delphi.ai iframe wrapper
│   ├── LibrarySection.ts     # Library with filter + cards
│   ├── LibraryCard.ts        # Single library resource card
│   ├── FilterBar.ts          # Category filter buttons
│   ├── FilmSection.ts        # Film intro + poster grid
│   ├── FilmCard.ts           # Single film poster card
│   ├── AboutSection.ts       # Bio, photo, social links
│   └── Footer.ts             # Mist-fade footer
├── data/
│   ├── artworks.ts           # 45 artwork entries with real image URLs
│   ├── library-items.ts      # 64 library resources
│   └── films.ts              # 12 film entries with real poster URLs
├── router.ts                 # Hash-based SPA routing
└── main.ts                   # Entry point, mounts app
```

---

## 4. CSS Architecture

### 4.1 Design Tokens (`tokens.css`)

```css
:root {
  /* ===== FOUNDATION COLORS ===== */
  --bg-primary: #E8E5E3;                          /* warm sand body */
  --bg-surface: #F8F6F3;                           /* cream card surfaces */
  --bg-elevated: rgba(255, 255, 255, 0.55);        /* frosted glass fill */
  --bg-nav: rgba(248, 246, 244, 0.72);             /* translucent navbar */

  /* ===== OCEAN BLUES (Big Sur coastal) ===== */
  --ocean-deep: #1B3A4B;                           /* primary CTA, headings */
  --ocean-mid: #3D6B8E;                            /* hover state for CTAs */
  --ocean-light: #6B9DBF;                          /* accent, focus rings */
  --ocean-mist: #A8C8DC;                           /* secondary surfaces */
  --ocean-foam: #D4E6F0;                           /* light accent fills */

  /* ===== WARM EARTH ===== */
  --sand-warm: #C4A882;
  --sand-light: #DDD0BE;
  --cliff-warm: #8B7355;

  /* ===== TEXT ===== */
  --text-primary: #2A2A2A;
  --text-secondary: #5A5A5A;
  --text-link: #1B3A4B;

  /* ===== LIBRARY CATEGORY COLORS (desaturated) ===== */
  --cat-history: #D4845A;
  --cat-science: #5A9DB8;
  --cat-biology: #6BA88A;
  --cat-story: #B87AA8;
  --cat-architecture: #7B6BAD;
  --cat-design: #C76B7B;
  --cat-art: #C9A050;
  --cat-tools: #6B6B6B;
  --cat-film: #6B73AD;
  --cat-typography: #5AADAD;
  --cat-anatomy: #C7607B;
  --cat-color: #5AAD6B;
  --cat-dance: #AD7BAD;
  --cat-music: #7BA8AD;
  --cat-philosophy: #8B7B6B;
  --cat-ai: #5A8BB8;
  --cat-computer-science: #6B8BAD;
  --cat-drawing: #AD8B5A;
  --cat-game-design: #7BAD7B;
  --cat-buckhouse: #AD6B5A;
  --cat-jobs: #5A7BAD;

  /* ===== BORDER RADIUS ===== */
  --radius-sm: 8px;                                /* tags, badges */
  --radius-md: 12px;                               /* images within cards */
  --radius-lg: 16px;                               /* cards, modals (Big Sur window radius) */
  --radius-xl: 20px;                               /* hero images, profile photos */
  --radius-pill: 9999px;                           /* CTAs, filter buttons */

  /* ===== BOX SHADOWS ===== */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04),
               0 1px 2px rgba(0, 0, 0, 0.03);
  --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.08),
               0 2px 8px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.12),
               0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-xl: 0 24px 64px rgba(0, 0, 0, 0.16),
               0 8px 24px rgba(0, 0, 0, 0.08);

  /* ===== BACKDROP FILTERS (frosted glass) ===== */
  --glass-light: blur(12px) saturate(150%);        /* card surfaces */
  --glass-medium: blur(20px) saturate(180%);       /* navbar */
  --glass-heavy: blur(40px) saturate(200%);        /* lightbox overlay */

  /* ===== TYPOGRAPHY ===== */
  --font-body: "Unica77", sans-serif;
  --font-nav: "Pitch Sans", sans-serif;
  --font-heading: "FinancierDisplay", serif;

  --text-base: 16px;
  --text-sm: 13.6px;
  --text-md: 18px;
  --text-lg: 24px;
  --text-xl: 40px;
  --text-hero: 64px;

  --leading-tight: 1.3;
  --leading-normal: 1.65;
  --leading-relaxed: 1.8;

  /* ===== SPACING ===== */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  /* ===== LAYOUT ===== */
  --container-width: 1200px;
  --navbar-height: 64px;
  --grid-gap: 24px;
  --grid-column: 376px;
  --grid-side-padding: 48px;

  /* ===== TRANSITIONS ===== */
  --ease-out: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --duration-fast: 0.2s;
  --duration-normal: 0.35s;
  --duration-slow: 0.6s;

  /* ===== BACKGROUND GRADIENT ===== */
  --gradient-sky: linear-gradient(180deg, #D4E6F0 0%, #E8E5E3 100%);
}
```

### 4.2 Component Styles

Each component's CSS is in its own file under `styles/components/`. See Section 5 for exact CSS per component.

### 4.3 Utility Classes (`utilities.css`)

```css
/* Visually hidden (screen reader only) */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Frosted glass surface */
.glass {
  background: var(--bg-elevated);
  backdrop-filter: var(--glass-light);
  -webkit-backdrop-filter: var(--glass-light);
  border: 1px solid rgba(255, 255, 255, 0.35);
}

/* Container */
.container {
  max-width: var(--container-width);
  margin: 0 auto;
  padding: 0 var(--grid-side-padding);
}
```

### 4.4 State Styles (`states.css`)

```css
/* Global focus indicator */
:focus-visible {
  outline: 2px solid rgba(107, 157, 191, 0.5);
  outline-offset: 2px;
}

/* Loading shimmer for lazy images */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.img-loading {
  background: linear-gradient(90deg, #E8E5E3 25%, #F0EDEB 50%, #E8E5E3 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

/* Fade in for loaded images */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.img-loaded {
  animation: fadeIn 0.3s ease-out;
}
```

---

## 5. Component Specifications

### 5.1 Navbar (Frosted Glass)

The navbar is the single most important Big Sur element. It MUST have `backdrop-filter: blur()`.

```css
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  height: var(--navbar-height);                     /* 64px */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-lg);

  /* FROSTED GLASS — the defining Big Sur feature */
  background: var(--bg-nav);                        /* rgba(248, 246, 244, 0.72) */
  backdrop-filter: var(--glass-medium);             /* blur(20px) saturate(180%) */
  -webkit-backdrop-filter: var(--glass-medium);
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);

  font-family: var(--font-nav);
  text-transform: uppercase;
  font-size: var(--text-base);
}

.navbar-link {
  color: var(--text-primary);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) ease,
              background-color var(--duration-fast) ease;
}

.navbar-link:hover {
  color: var(--ocean-deep);
  background: rgba(27, 58, 75, 0.08);
}

.navbar-link.active {
  color: var(--ocean-deep);
  font-weight: 600;
}

.navbar-newsletter {
  background-color: var(--ocean-deep);
  color: #fff;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-pill);
  font-weight: 500;
  text-decoration: none;
  box-shadow: var(--shadow-sm);
  transition: background-color var(--duration-fast) ease,
              transform var(--duration-fast) ease,
              box-shadow var(--duration-fast) ease;
}

.navbar-newsletter:hover {
  background-color: var(--ocean-mid);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.navbar-newsletter:active {
  background-color: #153040;
  transform: translateY(0);
  box-shadow: var(--shadow-sm);
}
```

**Mobile (<=768px):** Hamburger menu icon replaces horizontal nav. Menu slides down as a frosted glass panel.

### 5.2 Artwork Cards (REAL Images via `<img>` Tags)

**CRITICAL: Every artwork card contains a real `<img>` tag pointing to `https://jamesbuckhouse.com/images/...`. NO colored placeholder divs. NO `background-color` substitutions.**

```css
.artwork-card-link {
  display: block;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}

.artwork-card-sizer {
  position: relative;
  width: 100%;
  padding-bottom: 100%;                             /* 1:1 aspect ratio */
  overflow: hidden;
  border-radius: var(--radius-lg);                  /* 16px */

  /* FROSTED GLASS CARD SURFACE */
  background: var(--bg-elevated);                   /* rgba(255, 255, 255, 0.55) */
  backdrop-filter: var(--glass-light);              /* blur(12px) saturate(150%) */
  -webkit-backdrop-filter: var(--glass-light);
  border: 1px solid rgba(255, 255, 255, 0.35);

  box-shadow: var(--shadow-md);
  transition: transform var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
}

.artwork-card-sizer:hover {
  transform: translateY(-4px);                      /* lift, not scale */
  box-shadow: var(--shadow-lg);
}

/* THE ACTUAL IMAGE — loaded from jamesbuckhouse.com */
.artwork-card-sizer img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 50%;
  border-radius: var(--radius-md);                  /* 12px, slightly inset from card */
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05);
  transition: transform var(--duration-slow) var(--ease-out);
}

.artwork-card-link:hover .artwork-card-sizer img {
  transform: scale(1.03);                           /* subtle Ken Burns within clipped frame */
}

.artwork-card-title {
  font-size: var(--text-md);                        /* 18px */
  font-family: var(--font-body);
  font-weight: 500;
  color: var(--text-primary);
  text-align: left;                                 /* left-aligned, not centered */
  padding: var(--space-md);
  margin: var(--space-sm) 0 0;
  line-height: var(--leading-tight);
}
```

**HTML template for each card:**
```html
<a href="#/art/{N}" class="artwork-card-link">
  <div class="artwork-card-sizer">
    <img
      src="https://jamesbuckhouse.com/images/image_{X}.jpg"
      alt="{Artwork Title}"
      loading="lazy"
      decoding="async"
    >
  </div>
  <p class="artwork-card-title">{Artwork Title}</p>
</a>
```

### 5.3 Gallery Grid (Responsive)

```css
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, var(--grid-column));  /* 3 x 376px */
  gap: var(--grid-gap);                                   /* 24px */
  padding: var(--space-xl) var(--grid-side-padding);      /* 32px 48px */
  max-width: var(--container-width);
  margin: 0 auto;
  margin-top: var(--navbar-height);                       /* clear fixed nav */
}

/* Tablet: 2 columns */
@media (max-width: 980px) {
  .gallery-grid {
    grid-template-columns: repeat(2, 1fr);
    padding: var(--space-xl) var(--space-lg);
  }
}

/* Mobile: 1 column */
@media (max-width: 768px) {
  .gallery-grid {
    grid-template-columns: 1fr;
    max-width: 400px;
    padding: var(--space-xl) var(--space-md);
  }
}
```

### 5.4 Lightbox (Artwork Detail View)

New component — the original site lacks an immersive detail view.

```css
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;

  /* HEAVY FROSTED GLASS BACKDROP */
  background: rgba(30, 40, 50, 0.4);
  backdrop-filter: var(--glass-heavy);              /* blur(40px) saturate(200%) */
  -webkit-backdrop-filter: var(--glass-heavy);

  animation: fadeIn 0.3s ease-out;
}

.lightbox-image {
  max-width: 90vw;
  max-height: 85vh;
  border-radius: var(--radius-xl);                  /* 20px */
  box-shadow: var(--shadow-xl);
  object-fit: contain;
}

.lightbox-close {
  position: absolute;
  top: var(--space-lg);
  right: var(--space-lg);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) ease;
}

.lightbox-close:hover {
  background: rgba(255, 255, 255, 0.35);
}

.lightbox-title {
  position: absolute;
  bottom: var(--space-xl);
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  font-family: var(--font-body);
  font-size: var(--text-lg);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
```

### 5.5 Library Section

```css
.library-heading {
  font-family: var(--font-heading);
  font-size: var(--text-hero);                      /* 64px */
  font-weight: 300;                                 /* lighter than original 400 */
  text-transform: none;                             /* drop uppercase */
  text-align: center;
  color: var(--ocean-deep);
  margin-bottom: var(--space-lg);
}

.library-intro {
  font-family: var(--font-body);
  font-size: var(--text-md);
  color: var(--text-secondary);
  text-align: center;
  max-width: 640px;
  margin: 0 auto var(--space-xl);
  line-height: var(--leading-normal);
}

.library-intro a {
  color: var(--text-link);
  text-decoration: underline;
}

/* Filter Buttons */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  justify-content: center;
  padding: 0 var(--space-lg);
  margin-bottom: var(--space-xl);
}

.filter-btn {
  padding: var(--space-sm) 14px;
  border-radius: var(--radius-pill);
  font-family: var(--font-nav);
  font-size: var(--text-sm);
  text-transform: uppercase;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: var(--bg-surface);
  color: var(--text-primary);
  cursor: pointer;
  min-height: 44px;                                 /* touch target fix */
  transition: all var(--duration-fast) ease;
}

.filter-btn:hover:not(.active) {
  background: var(--ocean-foam);
  border-color: var(--ocean-mist);
  transform: translateY(-1px);
}

.filter-btn.active {
  background: var(--ocean-deep);
  color: var(--bg-surface);
  border-color: var(--ocean-deep);
}

/* Library Cards */
.library-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--grid-gap);
  max-width: var(--container-width);
  margin: 0 auto;
  padding: 0 var(--grid-side-padding);
}

.timeline-item {
  padding: var(--space-lg);
  border-radius: var(--radius-lg);
  text-decoration: none;
  color: inherit;
  text-align: left;

  /* FROSTED GLASS */
  background: var(--bg-elevated);
  backdrop-filter: var(--glass-light);
  -webkit-backdrop-filter: var(--glass-light);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-left: 3px solid var(--category-color);     /* per-category accent */

  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
}

.timeline-item:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}

.timeline-item h3 {
  font-family: var(--font-body);
  font-size: var(--text-md);
  font-weight: 600;
  margin-bottom: var(--space-sm);
  color: var(--text-primary);
}

.timeline-item .instructor {
  font-size: var(--text-base);
  color: var(--text-secondary);
  margin-bottom: var(--space-sm);
}

.timeline-item .description {
  font-size: var(--text-base);
  color: var(--text-secondary);
  line-height: var(--leading-normal);
}

@media (max-width: 980px) {
  .library-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
  .library-grid { grid-template-columns: 1fr; }
  .library-heading { font-size: var(--text-xl); }
}
```

### 5.6 Film Section

```css
.film-intro {
  font-family: var(--font-body);
  font-size: var(--text-md);
  color: var(--text-secondary);
  max-width: 720px;
  margin: 0 auto var(--space-xl);
  text-align: center;
  line-height: var(--leading-normal);
}

.film-intro strong {
  color: var(--text-primary);
  font-weight: 600;
}

.film-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--grid-gap);
  max-width: var(--container-width);
  margin: 0 auto;
  padding: 0 var(--grid-side-padding);
}

.film-card {
  display: block;
  text-decoration: none;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-md);
  transition: transform 0.4s var(--ease-out),
              box-shadow 0.4s var(--ease-out);
}

.film-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

/* REAL FILM POSTER IMAGE */
.film-card-image {
  position: relative;
  overflow: hidden;
}

.film-card-image img {
  width: 100%;
  height: auto;
  display: block;
  transition: transform var(--duration-slow) var(--ease-out);
}

.film-card:hover .film-card-image img {
  transform: scale(1.03);
}

.film-card-title {
  font-family: var(--font-body);
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text-primary);
  padding: var(--space-md);
  background: var(--bg-elevated);
  backdrop-filter: var(--glass-light);
  -webkit-backdrop-filter: var(--glass-light);
}

@media (max-width: 980px) {
  .film-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
  .film-grid { grid-template-columns: 1fr; }
}
```

### 5.7 About Section

```css
.about-section {
  max-width: 800px;
  margin: 0 auto;
  padding: var(--space-2xl) var(--grid-side-padding);
}

/* REAL PROFILE PHOTO */
.about-image {
  width: 100%;
  max-width: 736px;
  border-radius: var(--radius-xl);                  /* 20px */
  box-shadow: var(--shadow-lg);
  object-fit: cover;
  display: block;
  margin-bottom: var(--space-xl);
}

.about-text {
  background: var(--bg-elevated);
  backdrop-filter: var(--glass-light);
  -webkit-backdrop-filter: var(--glass-light);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.about-text p {
  font-family: var(--font-body);
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  color: var(--text-primary);
  margin-bottom: var(--space-md);
}

.about-text a {
  color: var(--text-link);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.about-text a:hover {
  color: var(--ocean-mid);
}

/* Social Links Grid */
.social-links {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
  margin-top: var(--space-xl);
}

.social-link {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  min-height: 44px;                                 /* touch target */
  border-radius: var(--radius-lg);
  text-decoration: none;
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--ocean-deep);

  /* FROSTED GLASS */
  background: var(--bg-elevated);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.35);

  transition: all var(--duration-normal) var(--ease-out);
}

.social-link:hover {
  background: var(--ocean-foam);
  border-color: var(--ocean-mist);
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}

.social-link:active {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.social-link i {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

@media (max-width: 768px) {
  .social-links { grid-template-columns: repeat(2, 1fr); }
}
```

### 5.8 Footer (New)

```css
.footer {
  padding: var(--space-2xl);
  background: linear-gradient(180deg, transparent 0%, rgba(27, 58, 75, 0.04) 100%);
  text-align: center;
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: 14px;
}
```

### 5.9 24-Hour Hotline (Delphi Embed)

```css
.hotline-section {
  margin-top: var(--navbar-height);
  width: 100%;
  height: calc(100vh - var(--navbar-height));
}

.hotline-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
```

```html
<section class="hotline-section">
  <iframe
    class="hotline-iframe"
    src="https://www.delphi.ai/buckhouse"
    title="24-Hour Hotline — Chat with James Buckhouse"
    allow="microphone"
  ></iframe>
</section>
```

---

## 6. Complete Interaction States

| Element | Default | Hover | Focus-visible | Active/Press |
|---|---|---|---|---|
| Nav link | `color: var(--text-primary)` | `color: var(--ocean-deep); bg: rgba(27,58,75,0.08)` | `outline: 2px solid rgba(107,157,191,0.5); offset: 2px` | `color: var(--ocean-deep); font-weight: 600` |
| Newsletter CTA | `bg: var(--ocean-deep); shadow-sm` | `bg: var(--ocean-mid); shadow-md; translateY(-1px)` | `outline: 2px solid rgba(107,157,191,0.5); offset: 2px` | `bg: #153040; translateY(0); shadow-sm` |
| Art card | `shadow-md; glass bg` | `translateY(-4px); shadow-lg` | `outline: 2px solid rgba(107,157,191,0.5); offset: 4px` | `translateY(-2px); shadow-md` |
| Art image (inside card) | `inset border; radius-md` | `scale(1.03) clipped by card overflow` | inherited from card | inherited from card |
| Library card | `shadow-sm; glass bg; left-border accent` | `translateY(-3px); shadow-md` | `outline: 2px solid rgba(107,157,191,0.5); offset: 2px` | `translateY(-1px); shadow-sm` |
| Filter btn (inactive) | `bg: var(--bg-surface); subtle border` | `bg: var(--ocean-foam); border: var(--ocean-mist); translateY(-1px)` | `outline: 2px solid rgba(107,157,191,0.5); offset: 2px` | `bg: var(--ocean-mist)` |
| Filter btn (active) | `bg: var(--ocean-deep); color: var(--bg-surface)` | no change (already selected) | `outline: 2px solid rgba(107,157,191,0.5); offset: 2px` | — |
| Film card | `shadow-md; radius-lg` | `translateY(-4px); shadow-lg` | `outline: 2px solid rgba(107,157,191,0.5); offset: 4px` | `translateY(-2px); shadow-md` |
| Social link | `glass bg; radius-lg` | `bg: var(--ocean-foam); translateY(-3px); shadow-md` | `outline: 2px solid rgba(107,157,191,0.5); offset: 2px` | `translateY(-1px); shadow-sm` |
| Lightbox close | `bg: rgba(255,255,255,0.2); blur(8px)` | `bg: rgba(255,255,255,0.35)` | `outline: 2px solid rgba(107,157,191,0.5)` | `bg: rgba(255,255,255,0.15)` |

---

## 7. Implementation Priority Order

### P0 — Foundation (Must Ship)

These are load-bearing. Without them, there is no site.

1. **`tokens.css`** — All design tokens (colors, radii, shadows, glass filters, typography, spacing, transitions). Everything else references these.
2. **`base.css`** — Body background (`var(--bg-primary)`), font defaults, line-height 1.65, scroll behavior.
3. **`navbar.css` + `Navbar.ts`** — Frosted glass navbar with 6 nav items and hash routing. This is the first thing users see and the defining Big Sur element.
4. **`artwork-card.css` + `ArtworkCard.ts`** — Cards with **real `<img>` tags** loading from `https://jamesbuckhouse.com/images/`. 1:1 aspect ratio, 16px radius, frosted glass surface, lift hover.
5. **`gallery-grid.css` + `GalleryGrid.ts`** — 3-column responsive grid holding all 45 artwork cards.
6. **`data/artworks.ts`** — Data file with all 45 entries: `{ id, title, imageUrl, route }`.
7. **`router.ts`** — Hash-based SPA routing for `#/`, `#/design`, `#/library`, `#/film`, `#/about`, `#/art/{N}`.
8. **`states.css`** — `:focus-visible` outlines, loading shimmer, fade-in animation.

### P1 — Core Sections (Ship Next)

9. **`about.css` + `AboutSection.ts`** — Profile photo (`<img>` tag with real URL), bio paragraphs with inline links, social links grid with frosted glass cards.
10. **`film-card.css` + `FilmSection.ts` + `FilmCard.ts`** — Film intro text, 12 poster cards with **real `<img>` tags**, IMDB links.
11. **`data/films.ts`** — Data file with all 12 entries: `{ id, title, posterUrl, imdbUrl }`.
12. **`library-card.css` + `filter-bar.css` + `LibrarySection.ts`** — Library heading, intro paragraph, 22 filter buttons (44px min touch target), 64 resource cards with category-colored left borders.
13. **`data/library-items.ts`** — Data file with all 64 entries: `{ id, title, instructor, description, url, categories }`.
14. **`HotlineEmbed.ts`** — Delphi.ai iframe embed for the 24-Hour Hotline section.

### P2 — Enhancement (Polish)

15. **`lightbox.css` + `Lightbox.ts`** — Frosted glass lightbox overlay for artwork detail view. Heavy blur backdrop, 20px radius image, close button, title overlay.
16. **`footer.css` + `Footer.ts`** — Mist-fade gradient footer with subtle ocean-deep tint.
17. **`utilities.css`** — `.sr-only`, `.glass`, `.container` utility classes.
18. **Responsive refinements** — Mobile hamburger nav, tablet 2-column grids, proper touch targets on all interactive elements.

### P3 — Delight (If Time Allows)

19. **Scroll-triggered section fade-ins** — Sections animate in as user scrolls (IntersectionObserver + CSS transitions).
20. **Image lazy-loading with shimmer** — Show loading shimmer placeholder while real images load, then fade in.
21. **Keyboard navigation** — Arrow keys to navigate gallery, Escape to close lightbox.
22. **Subtle sky-to-sand background gradient** — `var(--gradient-sky)` applied to body for a coastal atmosphere effect.

---

## Appendix A: Data Integrity Checklist

- [ ] All 45 art image URLs point to `https://jamesbuckhouse.com/images/image_{N}.jpg`
- [ ] All 12 film poster URLs point to `https://jamesbuckhouse.com/images/film-posters/{name}.jpg`
- [ ] Profile photo URL is `https://jamesbuckhouse.com/images/James_Buckhouse_Profile_Pic.jpg`
- [ ] Video URL is `https://jamesbuckhouse.com/images/video/mayron_install.mp4`
- [ ] All 64 library items have correct external URLs
- [ ] All 12 IMDB links are correct
- [ ] All 6 social links are correct
- [ ] Delphi iframe points to `https://www.delphi.ai/buckhouse`
- [ ] Newsletter link points to `https://jamesbuckhouse.substack.com/`
- [ ] Library suggestion link points to correct Airtable form URL
- [ ] Zero colored placeholder divs exist — every artwork card uses `<img>`
- [ ] All `<img>` tags have meaningful `alt` attributes matching the artwork title
- [ ] All images use `loading="lazy"` (except the profile photo which uses `loading="eager"`)

## Appendix B: External Dependencies

| Resource | URL | Purpose |
|---|---|---|
| Font Awesome 6.5.2 | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css` | Social link icons |
| Unica77 | Self-hosted or loaded from original site CSS | Body typeface |
| Pitch Sans | Self-hosted or loaded from original site CSS | Navigation typeface |
| FinancierDisplay | Self-hosted or loaded from original site CSS | Section heading typeface |
| Delphi.ai | `https://www.delphi.ai/buckhouse` | 24-Hour Hotline iframe |
