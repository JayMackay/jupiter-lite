// Standard reading documents follow the app palette. Custom designs and media keep theirs.
import { palettes, themeVariables } from './appearance.mjs';

export const reportThemeCSS = palettes.filter(p => p.id !== 'dark').map(p => {
  const root = 'html[data-jupiter-theme=' + p.id + ']:not([data-jupiter-theme=custom])';
  const doc = root + '[data-jupiter-report=document]';
  const vars = { ...themeVariables(p.id), '--bg': p.panel, '--card': p.raised, '--card2': p.bg, '--border': 'var(--jupiter-border)', '--muted': p.muted, '--card-glass': p.raised };
  return `
${root}{color-scheme:${p.scheme};background-color:${p.panel};color:${p.text}}
${root},${root} body,${root} body *{scrollbar-color:${p.muted} ${p.bg}!important;scrollbar-width:thin}
${root} ::-webkit-scrollbar-track,${root} ::-webkit-scrollbar-corner{background:${p.bg}!important}
${root} ::-webkit-scrollbar-thumb{background:${p.muted}!important;border-color:${p.bg}}
${doc}{${Object.entries(vars).map(([key, value]) => key + ':' + value + '!important').join(';')}}
${doc} body{background:${p.panel}!important;color:${p.text}!important}
${doc} body::before{opacity:0!important}
${doc} :is(h1,h2,h3,h4,strong,.card-title){color:var(--text-bright)!important;border-color:var(--jupiter-border)!important}
${doc} :is(.meta,.subtitle,.sub,.muted,.eyebrow,.label,.card-desc,.var-label,.status,.stats small,em){color:${p.muted}!important}
${doc} :is(.card,.jupiter-card,.obj-card,.verdict,.variant,.title-card,.kpi,main>section,main>header,main>figure){background:${p.raised}!important;border-color:var(--jupiter-border)!important;box-shadow:none!important}
${doc} :is(a,code){color:${p.accent}!important}
${doc} :is(pre,code,.flow,th){background:${p.bg}!important;border-color:var(--jupiter-border)!important}
${doc} pre code{background:none!important}
${doc} :is(th,td){color:${p.text}!important;border-color:var(--jupiter-border)!important}
${doc} :is(button,select,summary){color:${p.text};border-color:var(--jupiter-border)}
${root} dialog.jupiter-lightbox{background:${p.bg};color:${p.text};border-color:${p.muted}}
${root} .jupiter-lightbox .jupiter-lightbox-toolbar{background:${p.panel};border-color:${p.muted}}
${root} .jupiter-lightbox .jupiter-lightbox-caption,${root} .jupiter-lightbox .jupiter-lightbox-note{color:${p.muted}}
${root} .jupiter-lightbox .jupiter-lightbox-toolbar :is(button,a){background:${p.raised}!important;color:${p.text}!important;border-color:${p.muted}}
`;
}).join('\n');
