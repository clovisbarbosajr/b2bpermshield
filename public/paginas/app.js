(function () {
  document.querySelectorAll('[data-year]').forEach(function (node) { node.textContent = new Date().getFullYear(); });

  document.querySelectorAll('.password-toggle').forEach(function (button) {
    button.addEventListener('click', function () {
      var input = button.parentElement.querySelector('input');
      var visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      button.textContent = visible ? 'SHOW' : 'HIDE';
      button.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    });
  });

  document.querySelectorAll('.auth-form').forEach(function (form) {
    var status = form.querySelector('.form-status');
    form.addEventListener('submit', function (event) {
      var firstMissing = Array.from(form.querySelectorAll('input[required]')).find(function (input) { return !input.value.trim(); });
      if (firstMissing) {
        event.preventDefault();
        firstMissing.focus();
        firstMissing.closest('.auth-field').classList.add('is-error');
        status.className = 'form-status is-error';
        status.textContent = form.getAttribute('data-missing-message') || 'Please complete your username and password.';
        return;
      }
      if (form.getAttribute('action') === '#') {
        event.preventDefault();
        status.className = 'form-status is-success';
        status.textContent = form.getAttribute('data-success-message') || 'Interface ready — connect this form to your authentication endpoint.';
      }
    });
    form.querySelectorAll('input').forEach(function (input) {
      input.addEventListener('input', function () { input.closest('.auth-field')?.classList.remove('is-error'); });
    });
  });

  var glow = document.querySelector('.cursor-glow');
  if (glow && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.addEventListener('pointermove', function (event) {
      glow.style.setProperty('--x', event.clientX + 'px');
      glow.style.setProperty('--y', event.clientY + 'px');
    });
  }

  var parallax = document.querySelector('[data-parallax]');
  if (parallax && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    parallax.addEventListener('pointermove', function (event) {
      var box = parallax.getBoundingClientRect();
      var x = (event.clientX - box.left) / box.width - .5;
      var y = (event.clientY - box.top) / box.height - .5;
      parallax.style.setProperty('--px', (x * 12) + 'px');
      parallax.style.setProperty('--py', (y * 12) + 'px');
    });
    parallax.addEventListener('pointerleave', function () {
      parallax.style.setProperty('--px', '0px');
      parallax.style.setProperty('--py', '0px');
    });
  }
})();
