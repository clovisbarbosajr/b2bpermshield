const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('ships all four English portal pages', () => {
  for (const file of ['index.html', 'admin-login.html', 'customers-login.html', 'reset-password.html']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} is missing`);
    assert.match(read(file), /lang="en"/);
  }
});

test('customer forgot-password flow opens a dedicated reset page', () => {
  const customer = read('customers-login.html');
  const reset = read('reset-password.html');
  assert.match(customer, /href="reset-password\.html"[^>]*>Forgot password\?/i);
  assert.match(reset, /autocomplete="email"/);
  assert.match(reset, /Send reset link/i);
  assert.match(reset, /href="customers-login\.html"/);
});

test('landing page links to both direct login destinations', () => {
  const html = read('index.html');
  assert.match(html, /href="admin-login\.html"/);
  assert.match(html, /href="customers-login\.html"/);
});

test('login pages preserve the supplied form hierarchy', () => {
  const admin = read('admin-login.html');
  const customer = read('customers-login.html');
  for (const html of [admin, customer]) {
    assert.match(html, /autocomplete="username"/);
    assert.match(html, /autocomplete="current-password"/);
    assert.match(html, /class="password-toggle"/);
  }
  assert.match(customer, /Forgot password\?/i);
  assert.match(customer, /One-time login link/i);
  assert.match(customer, /Sign up/i);
});

test('package uses local brand assets and classic scripts for file mode', () => {
  for (const file of ['index.html', 'admin-login.html', 'customers-login.html', 'reset-password.html']) {
    const html = read(file);
    assert.match(html, /assets\/permshield-logo\.png/);
    assert.doesNotMatch(html, /type="module"/);
  }
  assert.equal(fs.existsSync(path.join(root, 'assets', 'flooring-hero.jpg')), true);
  assert.equal(fs.existsSync(path.join(root, 'styles.css')), true);
  assert.equal(fs.existsSync(path.join(root, 'app.js')), true);
});

test('CSS includes responsive and reduced-motion protections', () => {
  const css = read('styles.css');
  assert.match(css, /@media\s*\(max-width:/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
