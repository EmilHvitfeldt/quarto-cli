// A fixture extension for the emiljs smoke tests: a fence, a class, a stylesheet
// (style.css) and a runtime half (runtime.js), in the folder form.
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default {
  name: "shout",
  apiVersion: 1,
  build: {
    fences: {
      shout: (code) =>
        `<p class="ext-shout-line" data-ext-shout="loud">${esc(code.trim().toUpperCase())}</p>`,
    },
  },
  vocabulary: { classes: ["ext-shout-line"] },
  runtime: { enhancement: true },
};
