// The in-page preview player (used by server.mjs for /preview/…).
// Serve a composition for the in-page preview. A <base> tag makes the
// relative media/ paths resolve, and a small player stands in for the
// HyperFrames runtime: it windows every video and audio element by its
// data-start / data-duration / data-media-start, and drives the GSAP timeline
// off the footage's clock, keeping the cut-out and the audio in step.
export function playable(html) {
  html = html.replace("<head>", `<head>\n    <base href="/">`);
  html = html.replace("</body>", `
    <script>
      (function () {
        var root = document.getElementById("root");
        var tl = (window.__timelines || {})["main"];
        if (!root || !tl) return;
        var total = parseFloat(root.getAttribute("data-duration")) || 0;
        var quiet = function (p) { if (p && p.catch) p.catch(function () {}); };

        var media = Array.prototype.map.call(
          document.querySelectorAll("video[data-start], audio[data-start]"),
          function (el) {
            var start = parseFloat(el.getAttribute("data-start")) || 0;
            return {
              el: el, start: start,
              end: start + (parseFloat(el.getAttribute("data-duration")) || 0),
              from: parseFloat(el.getAttribute("data-media-start")) || 0,
              video: el.tagName === "VIDEO",
              // The footage is the clock while it plays; the cut-out and the
              // audio follow it.
              master: el.id === "bg",
            };
          });

        var t = 0, playing = false, last = null;
        window.__studioTime = function () { return t; };
        window.__studioDuration = total;

        function apply(hard) {
          tl.seek(t);
          media.forEach(function (m) {
            var on = t >= m.start && t < m.end;
            if (m.video) m.el.style.visibility = on ? "" : "hidden";
            if (!on) { if (!m.el.paused) m.el.pause(); return; }
            var want = m.from + (t - m.start);
            var slack = m.master ? 0.3 : m.video ? 0.08 : 0.2;
            if (hard || Math.abs(m.el.currentTime - want) > slack) m.el.currentTime = want;
            if (playing && m.el.paused) quiet(m.el.play());
            if (!playing && !m.el.paused) m.el.pause();
          });
        }

        function masterAt(time) {
          for (var i = 0; i < media.length; i++) {
            var m = media[i];
            if (m.master && time >= m.start && time < m.end) return m;
          }
          return null;
        }

        function frame(now) {
          if (playing) {
            var dt = last === null ? 0 : (now - last) / 1000;
            last = now;
            var m = masterAt(t);
            if (m && !m.el.paused && !m.el.seeking && m.el.readyState >= 3) {
              // Follow the footage while it plays; never step backwards.
              t = Math.max(t, m.start + (m.el.currentTime - m.from));
            } else {
              // Until the footage is actually playing, the wall clock does.
              t += dt;
            }
            if (t >= total) {
              t = total;
              playing = false;
              parent.postMessage({ type: "ended" }, "*");
            }
            apply(false);
          } else {
            last = null;
          }
          requestAnimationFrame(frame);
        }

        function seek(to) { t = Math.max(0, Math.min(to, total)); apply(true); }

        // The studio reopens this page on every edit and passes the moment it
        // wants to land on as #t=. URLSearchParams rather than a regex: this
        // whole script lives in a template literal, where a backslash escape
        // would be eaten before it reached the browser.
        var wanted = parseFloat(new URLSearchParams(location.hash.slice(1)).get("t") || "0");
        var ready = function (el) {
          return new Promise(function (r) {
            if (el.readyState >= 2) return r();
            el.addEventListener("loadeddata", r, { once: true });
            setTimeout(r, 4000);
          });
        };
        Promise.all(media.map(function (m) { return ready(m.el); })).then(function () {
          seek(wanted);
          parent.postMessage({ type: "ready", t: t }, "*");
        });
        requestAnimationFrame(frame);

        window.addEventListener("message", function (e) {
          var d = e.data;
          if (d === "play") { if (t >= total) t = 0; playing = true; apply(true); }
          if (d === "pause") { playing = false; apply(false); }
          if (d === "restart") { t = 0; playing = true; apply(true); }
          if (d && d.type === "seek") seek(d.t);
        });
      })();
    <\/script>
  </body>`);

  return html;
}
