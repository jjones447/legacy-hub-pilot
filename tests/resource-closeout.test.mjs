import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('unavailable caregiver resources have visible pending text, not dead download/read actions', () => {
  const html = read('caregiver-tools.html');
  assert.doesNotMatch(html, /data-action="demo-resource-link"/);
  assert.equal((html.match(/Resource link pending/g) || []).length, 5);
  assert.doesNotMatch(html, /<a[^>]+href="#"[^>]*>\s*(?:Read guide|Watch|Download PDF|Open guide)/);
});

test('crisis page does not advertise an unverified hotline or unavailable emergency guide', () => {
  const html = read('crisis-help.html');
  assert.doesNotMatch(html, /Caregiver Support Hotline|Call \/ details|data-action="demo-resource-link"/);
  assert.match(html, /Guide link pending/);
  assert.match(html, /href="tel:988"/);
  assert.match(html, /href="tel:911"/);
  assert.match(html, /href="https:\/\/www\.alz\.org\/help-support"/);
});

test('988 call actions describe the telephone action without promising to open texting', () => {
  for (const path of ['templates/crisis-help.html.j2', 'crisis-help.html']) {
    const html = read(path);
    const calls = [...html.matchAll(/<a\b[^>]*href="tel:988"[^>]*>([\s\S]*?)<\/a>/g)];
    assert.equal(calls.filter(([, label]) => /^Call 988(?: →)?$/.test(label)).length, 2);
    assert.ok(calls.every(([, label]) => !/text/i.test(label)));
    assert.match(html, /Call or text <strong>988<\/strong>/);
    assert.match(html, /href="tel:911"/);
  }
});

test('unconfirmed sample dates and registration counts are not presented as current events', () => {
  for (const page of ['index.html', 'events.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /class="month">Jul|class="month">Aug|18 registered|8 registered|9 registered|6 registered/);
    assert.match(html, /Schedule pending/);
  }
  assert.doesNotMatch(read('events.html'), /data-action="open-register"/);
});

test('request support points directly to real crisis contacts, not a fictitious caregiver hotline', () => {
  const html = read('request-support.html');
  assert.doesNotMatch(html, /for the caregiver support hotline/);
  assert.match(html, /href="crisis-help.html">Crisis &amp; Emergency Help/);
});

test('templates preserve confirmed-event registration and do not disable the live event API', () => {
  const events = read('templates/events.html.j2');
  assert.match(events, /ev\.schedule_confirmed \| default\(false\)/);
  assert.match(events, /data-action="open-register"/);
  assert.match(events, /data-event-id="\{\{ ev\.id/);
  assert.match(read('app.js'), /fetch\('\/api\/events'\)/);
});


const faqQuestions = [
  'What is Caregiver Sanctuary?',
  'Who can receive support from Caregiver Sanctuary?',
  'Do I need to consider myself a caregiver to participate?',
  'Does my loved one need a dementia diagnosis?',
  'How do I get started?',
  'Do I have to live in Milwaukee to participate?',
  'What programs does Legacy offer?',
  'What is respite care?',
  'Is respite care available in my home?',
  'Is your respite program appropriate for everyone living with dementia?',
  'What is the Caregiver Sanctuary Community Series?',
  'Can I participate in programs without bringing my loved one?',
  'How do I register for events and programs?',
  'Do you offer caregiver support groups?',
  "What if I'm not comfortable sharing in a support group?",
  'What is the Caregiver Wellness Passport?',
  'What are Caregiver Wellness Grants?',
  'How do I apply for a Wellness Grant?',
  'Is there a cost to join Caregiver Sanctuary?',
  'Do I need a referral from a doctor or healthcare provider?',
  "What if I need help but don't know which program is right for me?",
  'Are your programs accessible to caregivers with disabilities or special accommodations?',
  'What is the Caregiver Sanctuary Network?',
  'What is a Community Wellness Partner?',
  'What does it mean to be a caregiver-friendly or dementia-informed organization?',
  'Can my business, church, or organization become a Caregiver Sanctuary Partner?',
  'Does Legacy offer caregiver and dementia education or training?',
  'How can I volunteer with Legacy?',
  "How can I support Legacy's mission?",
  'What if I need immediate help or emergency support?',
];

function faqMain() {
  return read('faq.html').match(/<main id="main">([\s\S]*?)<\/main>/)[1];
}

test('client FAQ retains all thirty questions in six named, reachable categories', () => {
  const main = faqMain();
  const questions = [...main.matchAll(/<h3>([^<]+)<\/h3>/g)].map(([, text]) => text);
  assert.deepEqual(questions, faqQuestions);
  const sections = [...main.matchAll(/<section[^>]*id="([^"]+)"[^>]*aria-labelledby="([^"]+)"/g)];
  assert.equal(sections.length, 6);
  const categories = ['Getting Started &amp; Finding Support', 'Programs &amp; Respite Services',
    'Support Groups &amp; Caregiver Wellness', 'Cost, Eligibility &amp; Accessibility',
    'Caregiver Sanctuary Network &amp; Community Partners', 'Getting Involved &amp; Additional Support'];
  sections.forEach(([, id, labelId], index) => {
    assert.ok(main.includes(`href="#${id}"`));
    assert.ok(main.includes(`<h2 id="${labelId}">${index + 1}. ${categories[index]}</h2>`));
  });
  assert.match(main, /<ul>[\s\S]*Virtual Caregiver Support Group[\s\S]*Event Respite Services/);
});

test('FAQ actions reach existing destinations without inventing a request form or private join URL', () => {
  const main = faqMain();
  const required = ['programs.html', 'events.html', 'wellness-passport.html',
    'get-involved.html#partner', 'get-involved.html#training', 'get-involved.html#volunteer', 'request-support.html'];
  for (const href of required) assert.ok(main.includes(`href="${href}"`), `missing ${href}`);
  for (const [, href] of main.matchAll(/href="([^"]+)"/g)) {
    if (href.startsWith('tel:')) continue;
    const [file, fragment] = href.split('#');
    assert.ok(!file || existsSync(new URL(`../${file}`, import.meta.url)), `missing page ${href}`);
    if (fragment) assert.ok((file ? read(file) : main).includes(`id="${fragment}"`), `missing anchor ${href}`);
  }
  assert.match(main, /href="get-involved\.html#training" aria-describedby="faq-training-destination"/);
  assert.match(main, /id="faq-training-destination">This link opens training information and general contact details, not a dedicated request form\./);
  assert.doesNotMatch(main, /<form\b|data-action=|meet\.google|262-20[47]-7836|https?:\/\//);
});

test('FAQ preserves conditional grants, variable fees and nonmedical limits', () => {
  const main = faqMain();
  assert.match(main, /eligible caregivers with financial assistance of up to \$250 toward approved activities/);
  assert.match(main, /Grants are subject to eligibility requirements, application review, and available funding\./);
  assert.match(main, /If a particular activity has a fee, that information will be communicated in advance\./);
  assert.match(main, /Our programs are non-medical and may not be suitable/);
  assert.match(main, /Legacy is not an emergency response service and does not provide crisis intervention\./);
  assert.match(main, /href="tel:911">911<\/a>/);
  assert.match(main, /call or text <a href="tel:988">988<\/a>/);
  assert.match(main, /every Wednesday from 5:00 to 6:00 p\.m\. Central Time/);
});


test('About contact keeps address limits and the client-confirmed phone number', () => {
  for (const path of ['templates/about.html.j2', 'about.html']) {
    const contact = read(path).match(/<section id="contact">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(contact, `${path} must preserve the business CTA destination`);
    assert.match(contact, /Mailing address<\/h3>\s*<address[^>]*>PO Box 250403<br>Milwaukee, WI 53225<\/address>/);
    assert.match(contact, /Future physical location \(coming soon\)<\/h3>\s*<address[^>]*>7828 W Appleton Ave<br>Milwaukee, WI 53218<\/address>/);
    assert.equal((contact.match(/<address\b/g) || []).length, 2);
    assert.match(contact, /href="request-support\.html">Request caregiver support<\/a>/);
    assert.match(contact, /href="tel:\+12622047836">262-204-7836<\/a>/);
    assert.equal((contact.match(/href="tel:/g) || []).length, 1);
    assert.match(contact, /Email contact details will be published here\./);
    assert.doesNotMatch(contact, /262-207-7836|2622077836|Email and phone inquiry details coming|mailto:|<form\b|walk[ -]?in|open now|office hours|visit us at|invalid_auth|conflicting/i);
  }
});
