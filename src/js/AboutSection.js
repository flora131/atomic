/**
 * AboutSection component.
 * Creates the about (Buckhouse) section with profile photo, bio, and social links.
 */

const PROFILE_IMAGE_URL = 'https://jamesbuckhouse.com/images/James_Buckhouse_Profile_Pic.jpg';

const SOCIAL_LINKS = [
  { platform: 'LinkedIn', url: 'https://www.linkedin.com/in/jamesbuckhouse/' },
  { platform: 'Twitter', url: 'https://x.com/buckhouse' },
  { platform: 'Instagram', url: 'https://www.instagram.com/buckhouse/' },
  { platform: 'Read.cv', url: 'https://read.cv/buckhouse' },
  { platform: 'Delphi', url: 'https://www.delphi.ai/buckhouse' },
  { platform: 'Newsletter', url: 'https://jamesbuckhouse.substack.com/' },
];

// TODO: Implement full bio with inline links matching the content manifest
export function createAboutSection() {
  const section = document.createElement('section');
  section.className = 'about-section';

  const img = document.createElement('img');
  img.src = PROFILE_IMAGE_URL;
  img.alt = 'James Buckhouse';
  img.className = 'about-profile-image';
  section.appendChild(img);

  const bio = document.createElement('div');
  bio.className = 'about-bio';
  bio.innerHTML = '<p>James Buckhouse believes story, art, and design can bend the arc of humanity\'s progress, if you do it right, and brings that idea into everything he does: from movies to startups to paintings to books and to ballets.</p>';
  section.appendChild(bio);

  const socialLinks = document.createElement('div');
  socialLinks.className = 'about-social-links';

  SOCIAL_LINKS.forEach(({ platform, url }) => {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = platform;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    socialLinks.appendChild(a);
  });

  section.appendChild(socialLinks);
  return section;
}

export default createAboutSection;
