/*
 * Rolea Booster — mini-jeu d'ouverture de boosters
 * À coller dans Administration › Site › Code (fichier JS chargé en FIN de page).
 *
 * - Page du jeu  : une page Rolea contenant  <div id="booster-zone"></div>
 * - Page staff   : une page Rolea contenant  <div id="booster-admin"></div>
 * - Profils      : la collection s'ajoute toute seule sur la fiche des personnages inscrits
 */
(function () {
  "use strict";

  var CONFIG = {
    API: "https://booster-hkt-booster-api.vercel.app", // adresse de ton API Vercel, sans / à la fin
    GAME_ZONE: "booster-zone",
    ADMIN_ZONE: "booster-admin",
    PROFILE_ENABLED: true,
    PROFILE_TARGET: "main",               // sélecteur CSS du bloc où ajouter la collection sur un profil
    SHOW_CARD_TEXT: true,                 // false si tes illustrations contiennent déjà le nom de la carte
    PACK_NAME: "Booster",                 // texte écrit sur le paquet
    PACK_COLOR: "color-mix(in srgb, var(--hkt-strong, #8e1b2a) 38%, #0b0607)", // couleur du paquet (suit le thème)
    GILT: "var(--hkt-accent, #c9a45c)",   // filets, liens, anneaux (suit le thème)
    ACCENT: "var(--hkt-strong, #8c1c2b)", // bouton principal (suit le thème)
    THEME: "forum",                       // "forum" : reprend les polices et couleurs du forum ; "sombre" : panneau noir autonome
    LOAD_FONTS: false,                    // true : charge Cormorant Garamond + Inter (utile surtout avec THEME "sombre")
    DEBUG: false                          // true : affiche R.page dans la console à chaque page
  };

  if (!window.R) return;

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var ADMIN_KEY_STORE = "rolea-booster:admin";
  function codeKey(characterId) { return "rolea-booster:code:" + characterId; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) { return typeof u === "string" && /^https:\/\//i.test(u) ? u : ""; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.body) headers["Content-Type"] = "application/json";
    if (opts.code) headers["X-Player-Code"] = opts.code;
    if (opts.who) { // mode ouvert : on s'identifie par le personnage connecté
      headers["X-Character-Id"] = encodeURIComponent(String(opts.who.id));
      headers["X-Character-Name"] = encodeURIComponent(opts.who.name || "");
      headers["X-Character-Slug"] = encodeURIComponent(opts.who.slug || "");
    }
    if (opts.admin) headers["X-Admin-Key"] = opts.admin;
    return fetch(CONFIG.API + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!res.ok) {
          var err = new Error((data && data.error) || ("Erreur " + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function () {
      var err = new Error("Le serveur des boosters ne répond pas. Réessaie dans un instant.");
      err.status = 0;
      throw err;
    });
  }

  // Catalogue des cartes, chargé une seule fois
  var catalogPromise = null;
  function catalog() {
    if (!catalogPromise) {
      catalogPromise = api("/cards").then(function (c) {
        c.rarityById = {};
        c.rarities.forEach(function (r, i) { r.rank = i; c.rarityById[r.id] = r; });
        c.cardById = {};
        c.cards.forEach(function (card) { c.cardById[card.id] = card; });
        return c;
      }, function (e) { catalogPromise = null; throw e; });
    }
    return catalogPromise;
  }

  function fmtNextFree(iso) {
    var d = new Date(iso), tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === tomorrow.toDateString()) return "demain à " + time;
    return d.toLocaleDateString("fr-FR", { weekday: "long" }) + " à " + time;
  }

  // ---------------------------------------------------------------------------
  // Styles : thème sombre gothique, épuré (tout est préfixé rb- pour ne rien casser)
  // ---------------------------------------------------------------------------

  // Découpe du booster : bords crantés en haut et en bas, ligne de déchirure à ~50px
  var CAP_CLIP = "polygon(0% 7px,4.55% 0,9.09% 7px,13.64% 0,18.18% 7px,22.73% 0,27.27% 7px,31.82% 0,36.36% 7px,40.91% 0,45.45% 7px,50% 0,54.55% 7px,59.09% 0,63.64% 7px,68.18% 0,72.73% 7px,77.27% 0,81.82% 7px,86.36% 0,90.91% 7px,95.45% 0,100% 7px,100% 51px,90.91% 48px,81.82% 52px,72.73% 49px,63.64% 54px,54.55% 51px,45.45% 47px,36.36% 52px,27.27% 49px,18.18% 53px,9.09% 48px,0% 51px)";
  var BODY_CLIP = "polygon(0% 50px,9.09% 47px,18.18% 52px,27.27% 48px,36.36% 51px,45.45% 46px,54.55% 50px,63.64% 53px,72.73% 48px,81.82% 51px,90.91% 47px,100% 50px,100% calc(100% - 7px),95.45% 100%,90.91% calc(100% - 7px),86.36% 100%,81.82% calc(100% - 7px),77.27% 100%,72.73% calc(100% - 7px),68.18% 100%,63.64% calc(100% - 7px),59.09% 100%,54.55% calc(100% - 7px),50% 100%,45.45% calc(100% - 7px),40.91% 100%,36.36% calc(100% - 7px),31.82% 100%,27.27% calc(100% - 7px),22.73% 100%,18.18% calc(100% - 7px),13.64% 100%,9.09% calc(100% - 7px),4.55% 100%,0% calc(100% - 7px))";

  // Lit les polices et couleurs du forum pour que le jeu s'y fonde
  function clean(v) { return String(v || "").replace(/[;{}<>]/g, ""); }
  function forumTheme(el) {
    var cs = getComputedStyle(el || document.body);
    var heading = document.querySelector("h1, h2, h3");
    var bg = "", node = el || document.body;
    while (node && node.nodeType === 1) {
      var b = getComputedStyle(node).backgroundColor;
      if (b && b !== "transparent" && !/rgba\(.*,\s*0\)$/.test(b)) { bg = b; break; }
      node = node.parentElement;
    }
    return {
      text: clean(cs.color) || "#ece6dc",
      bg: clean(bg) || "#0e0c0f",
      font: clean(cs.fontFamily) || "system-ui,sans-serif",
      display: clean(heading && getComputedStyle(heading).fontFamily) || "Georgia,serif"
    };
  }

  function themeVars(el) {
    if (CONFIG.THEME === "sombre") {
      return "--rb-bg:#0e0c0f;--rb-text:#ece6dc;--rb-font:Inter,system-ui,sans-serif;--rb-display:'Cormorant Garamond',Georgia,serif;--rb-panel:#0e0c0f;--rb-border:transparent;";
    }
    var t = forumTheme(el);
    return "--rb-bg:" + t.bg + ";--rb-text:" + t.text + ";--rb-font:" + t.font + ";--rb-display:" + t.display +
      ";--rb-panel:var(--hkt-surface,color-mix(in srgb,var(--rb-text) 3%,transparent));--rb-border:var(--hkt-line,color-mix(in srgb,var(--rb-text) 10%,transparent));";
  }

  function injectStyles(el) {
    if (document.getElementById("rb-styles-v5")) return;
    ["rb-styles", "rb-styles-v4"].forEach(function (id) { var o = document.getElementById(id); if (o) o.remove(); });

    if (CONFIG.LOAD_FONTS) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=swap";
      document.head.appendChild(link);
    }

    var css = [
      /* Base */
      ".rb{" + themeVars(el) + "--rb-muted:color-mix(in srgb,var(--rb-text) 62%,transparent);--rb-line:color-mix(in srgb,var(--rb-text) 12%,transparent);--rb-gilt:" + CONFIG.GILT + ";--rb-pack:" + CONFIG.PACK_COLOR + ";--rb-accent:" + CONFIG.ACCENT + ";--rb-pgilt:color-mix(in srgb,var(--rb-gilt) 55%,#f3e9e6);container-type:inline-size;box-sizing:border-box;display:flex;flex-direction:column;gap:22px;padding:28px clamp(16px,4cqi,36px);border-radius:8px;background:var(--rb-panel);border:1px solid var(--rb-border);color:var(--rb-text);font-family:var(--rb-font);font-size:15px;font-weight:400;line-height:1.5;text-align:left}",
      ".rb *,.rb *::before,.rb *::after{box-sizing:border-box}",
      ".rb h2,.rb h3,.rb p{margin:0}",
      ".rb a{color:var(--rb-gilt)}",
      ".rb :focus-visible{outline:2px solid var(--rb-gilt);outline-offset:4px}",
      ".rb-display{font-family:var(--rb-display);font-weight:400;line-height:1.05;color:var(--rb-text)}",
      ".rb-title{font-size:clamp(38px,7cqi,58px);text-transform:uppercase;letter-spacing:-.01em;transform:scaleY(1.12);transform-origin:left bottom}",
      ".rb-subtitle{font-size:clamp(26px,4cqi,32px)}",
      ".rb-label{font-size:10px;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:var(--rb-muted)}",
      ".rb-muted{color:var(--rb-muted)}",
      ".rb-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:18px}",
      ".rb-stack{display:flex;flex-direction:column;gap:6px}",
      ".rb-chips{display:flex;flex-wrap:wrap;gap:10px}",
      ".rb-chip{display:flex;flex-direction:column;gap:6px;padding:10px 18px;border:1px solid var(--rb-line);border-radius:8px;min-width:130px}",
      ".rb-chip b{font-family:var(--rb-display);font-size:18px;font-weight:400;color:var(--rb-text)}",
      ".rb-rule{height:1px;background:linear-gradient(90deg,var(--rb-gilt),transparent);opacity:.5}",
      ".rb-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}",
      ".rb-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border-radius:999px;font:600 11px/1 var(--rb-font);letter-spacing:.16em;text-transform:uppercase;cursor:pointer;background:transparent;color:var(--rb-text);border:1px solid color-mix(in srgb,var(--rb-text) 25%,transparent);text-decoration:none}",
      ".rb-btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--rb-text) 55%,transparent)}",
      ".rb-btn:disabled{opacity:.4;cursor:not-allowed}",
      ".rb-btn-main{background:var(--rb-accent);border-color:var(--rb-accent);color:#f3ede4}",
      ".rb-btn-main:hover:not(:disabled){filter:brightness(1.15)}",
      ".rb-btn-sm{min-height:34px;padding:0 12px;font-size:10px}",
      ".rb-input{font:inherit;min-height:44px;padding:0 12px;border-radius:6px;border:1px solid color-mix(in srgb,var(--rb-text) 25%,transparent);background:rgba(255,255,255,.04);color:var(--rb-text)}",
      ".rb-box{padding:16px 18px;border:1px solid var(--rb-line);border-radius:8px}",
      ".rb-error{border-color:#a8293b;color:#f0a3ad}",
      ".rb-code{font:700 22px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.08em;color:var(--rb-gilt)}",
      ".rb details summary{cursor:pointer;color:var(--rb-muted)}",

      /* Booster à gauche, collection à droite */
      ".rb-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:28px 40px;align-items:start}",
      ".rb-side{position:sticky;top:24px;display:flex;flex-direction:column;align-items:center}",
      ".rb-side .rb-stage{min-height:0;padding:14px 0 0;gap:20px}",
      ".rb-main{display:flex;flex-direction:column;gap:18px;min-width:0;padding-left:40px;border-left:1px solid var(--rb-line)}",
      "@container (max-width:720px){.rb-layout{grid-template-columns:1fr}.rb-side{position:static}.rb-main{padding:22px 0 0;border-left:0;border-top:1px solid var(--rb-line)}}",

      /* Booster scellé */
      ".rb-stage{position:relative;isolation:isolate;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;min-height:360px;padding:12px 0;text-align:center}",
      ".rb-stage::before{content:'';position:absolute;z-index:-1;left:50%;top:0;width:250px;height:250px;transform:translateX(-50%);border:1.5px solid var(--rb-gilt);border-radius:50%;opacity:.35;pointer-events:none}",
      ".rb-stage::after{content:'';position:absolute;z-index:-1;left:50%;top:40px;width:300px;height:300px;transform:translateX(-50%);border:1px solid var(--rb-gilt);border-radius:50%;opacity:.15;pointer-events:none}",
      ".rb-pack{position:relative;width:220px;height:330px;padding:0;border:0;background:none;cursor:pointer;filter:drop-shadow(0 28px 40px rgba(0,0,0,.65));animation:rb-float 4.5s ease-in-out infinite;transition:transform .25s ease}",
      ".rb-pack:hover:not(:disabled){transform:translateY(-8px) rotate(-1.5deg)}",
      ".rb-pack:disabled{cursor:default;animation:none;opacity:.6;filter:grayscale(.35) drop-shadow(0 20px 30px rgba(0,0,0,.5))}",
      ".rb-pack-cap,.rb-pack-body{position:absolute;left:0;right:0;background:var(--rb-pack)}",
      ".rb-pack-cap{top:0;height:56px;clip-path:" + CAP_CLIP + "}",
      ".rb-pack-body{top:0;bottom:0;clip-path:" + BODY_CLIP + "}",
      ".rb-pack-perf{position:absolute;left:14px;right:14px;top:46px;border-top:1px dashed var(--rb-pgilt);opacity:.5}",
      ".rb-pack-sheen{position:absolute;inset:0;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.1) 48%,transparent 60%);background-size:260% 100%;animation:rb-sheen-pack 5s ease-in-out infinite}",
      ".rb-pack-frame{position:absolute;inset:64px 16px 18px;border:1px solid var(--rb-pgilt);opacity:.9}",
      ".rb-pack-frame+.rb-pack-frame{inset:70px 22px 24px;opacity:.35}",
      ".rb-pack-center{position:absolute;left:0;right:0;top:100px;display:flex;flex-direction:column;align-items:center;gap:22px;color:var(--rb-pgilt)}",
      ".rb-pack-name{font-family:var(--rb-display);font-weight:600;font-size:24px;letter-spacing:.22em;text-indent:.22em;text-transform:uppercase;white-space:nowrap}",
      ".rb-pack-text{display:flex;flex-direction:column;align-items:center;gap:8px}",
      ".rb-pack-count{font-size:10px;font-weight:600;letter-spacing:.24em;text-indent:.24em;text-transform:uppercase;opacity:.75}",
      ".rb-pack-wait{animation:rb-shake .45s ease-in-out infinite;pointer-events:none}",
      ".rb-tearing{animation:none;pointer-events:none}",
      ".rb-tearing .rb-pack-cap{animation:rb-capoff .55s cubic-bezier(.3,.7,.4,1) forwards}",
      ".rb-tearing .rb-pack-body{animation:rb-bodyout .45s .4s ease-in forwards}",
      "@keyframes rb-float{0%,100%{translate:0 0}50%{translate:0 -6px}}",
      "@keyframes rb-sheen-pack{0%,100%{background-position:100% 0}50%{background-position:0% 0}}",
      "@keyframes rb-shake{0%,100%{rotate:0deg}25%{rotate:-3deg}75%{rotate:3deg}}",
      "@keyframes rb-capoff{to{transform:translate(-40px,-70px) rotate(-16deg);opacity:0}}",
      "@keyframes rb-bodyout{to{transform:translateY(24px) scale(.94);opacity:0}}",

      /* Booster ouvert : pile | carte tirée | infos */
      ".rb-open{--rb-pw:150px;display:grid;grid-template-columns:200px minmax(0,1fr) 260px;grid-template-areas:'pile slot info';gap:32px;align-items:center;min-height:420px}",
      ".rb-pile-col{grid-area:pile}.rb-reveal-col{grid-area:slot}.rb-info{grid-area:info}",
      ".rb-pile-col{display:flex;flex-direction:column;align-items:center;gap:16px}",
      ".rb-pile{position:relative;width:var(--rb-pw);height:calc(var(--rb-pw) * 10 / 7);padding:0;border:0;background:none;cursor:pointer}",
      ".rb-pile:hover .rb-back:last-child{transform:translateY(-10px) rotate(-1deg)}",
      ".rb-pile-empty{width:var(--rb-pw);height:calc(var(--rb-pw) * 10 / 7);border:1px dashed color-mix(in srgb,var(--rb-text) 18%,transparent);border-radius:10px}",
      ".rb-back{position:absolute;width:var(--rb-pw);height:calc(var(--rb-pw) * 10 / 7);border-radius:10px;background:#1a1217;box-shadow:0 2px 0 rgba(0,0,0,.5),0 16px 30px rgba(0,0,0,.45);transition:transform .2s ease,opacity .2s ease;animation:rb-deal .35s ease-out backwards}",
      ".rb-back::before{content:'';position:absolute;inset:10px;border:1px solid var(--rb-pgilt);opacity:.55;border-radius:6px}",
      ".rb-back::after{content:'';position:absolute;inset:15px;border:1px solid var(--rb-pgilt);opacity:.2;border-radius:4px}",
      ".rb-reveal-col{display:flex;justify-content:center;perspective:1200px}",
      ".rb-slot{position:relative;width:280px;aspect-ratio:7/10}",
      ".rb-slot-empty{position:absolute;inset:0;border:1px dashed var(--rb-gilt);border-radius:10px;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;color:var(--rb-muted);opacity:.7}",
      ".rb-revealed{position:absolute;inset:0;padding:0;border:0;background:none;cursor:zoom-in;animation:rb-flipin .6s cubic-bezier(.2,.8,.3,1) backwards}",
      ".rb-info{display:flex;flex-direction:column;gap:12px}",
      ".rb-new-badge{align-self:flex-start;padding:5px 12px;border:1px solid var(--rb-gilt);border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--rb-gilt)}",
      ".rb-info-actions{display:flex;flex-direction:column;gap:10px;margin-top:6px;padding-top:18px;border-top:1px solid var(--rb-line)}",
      ".rb-draws{display:flex;flex-direction:column;gap:10px}",
      ".rb-slots{display:flex;flex-wrap:wrap;gap:10px}",
      ".rb-slots>*,.rb-slots>.rb-card{flex:none;width:56px;height:80px}",
      ".rb-thumb-empty{border:1px dashed color-mix(in srgb,var(--rb-text) 16%,transparent);border-radius:6px}",
      ".rb-slot-in{animation:rb-slotin .35s ease-out backwards}",
      "@keyframes rb-deal{from{opacity:0;transform:translateY(30px) scale(.95)}}",
      "@keyframes rb-flipin{from{transform:translateX(-200px) rotateY(-90deg) scale(.7);opacity:0}}",
      "@keyframes rb-slotin{from{opacity:0;transform:translateY(10px)}}",
      "@container (max-width:760px){.rb-open{--rb-pw:110px;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);grid-template-areas:'slot pile' 'slot info';gap:20px 28px;min-height:0}.rb-pile-col{align-items:flex-start}.rb-slot{width:min(260px,100%)}}",
      "@container (max-width:480px){.rb-open{grid-template-columns:1fr;grid-template-areas:'slot' 'pile' 'info';justify-items:center;text-align:center}.rb-pile-col{align-items:center}.rb-info{align-items:center}.rb-new-badge{align-self:center}.rb-info-actions{align-items:stretch;width:100%;max-width:320px}.rb-slot{width:220px}}",

      /* Cartes (format 7:10, illustrations 350x500) */
      ".rb-card{--rb-c:#8a9099;--mx:50%;--my:50%;--rx:0deg;--ry:0deg;container-type:inline-size;position:relative;width:100%;height:100%;border-radius:10px;overflow:hidden;background:#17131a;transform:perspective(900px) rotateX(var(--rx)) rotateY(var(--ry));transition:transform .15s ease-out;isolation:isolate}",
      ".rb-media{position:absolute;inset:0;z-index:0;overflow:hidden;clip-path:inset(0);border-radius:inherit}",
      ".rb-art-img{transform:translate(calc((50% - var(--mx)) / 12),calc((50% - var(--my)) / 12))}",
      ".rb-art{position:absolute;inset:-10%}",
      ".rb-cap{position:absolute;left:0;right:0;bottom:0;z-index:1;padding:20cqi 6.5cqi 6cqi;background:linear-gradient(to top,rgba(8,6,9,.94),rgba(8,6,9,.6) 55%,transparent);text-align:left}",
      ".rb-nm{font-family:var(--rb-display);font-weight:600;font-size:clamp(13px,8cqi,30px);line-height:1.15;color:#ece6dc}",
      ".rb-rr{margin-top:.4em;font-size:clamp(8px,3.6cqi,11px);font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#a39a91}",
      ".rb-new,.rb-qty{position:absolute;top:6cqi;z-index:4;padding:3px 7px;border-radius:4px;font-size:11px;font-weight:600;line-height:1}",
      ".rb-new{right:6cqi;background:var(--rb-accent);color:#f3ede4}",
      ".rb-qty{left:6cqi;background:rgba(8,6,9,.85);color:#ece6dc}",
      ".rb-card::before{content:'';position:absolute;inset:0;z-index:3;pointer-events:none;border-radius:inherit;padding:4px;background:var(--rb-frame,#4a434f);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}",
      ".rb-slot .rb-card::before,.rb-zoom .rb-card::before{padding:6px}",
      ".rb-slots .rb-card{border-radius:6px}.rb-slots .rb-card::before{padding:2px}",
      ".rb-slots .rb-cap,.rb-slots .rb-new,.rb-slots .rb-qty{display:none}",
      ".rb-card::after{content:'';position:absolute;inset:0;z-index:2;pointer-events:none;background-size:250% 250%,100% 100%;animation:rb-foil 5s ease-in-out infinite}",
      ".rb-f-normal::after{display:none}",
      ".rb-f-normal .rb-art{background:#1b171d}",
      ".rb-f-argent{--rb-frame:linear-gradient(135deg,#f4f5f7,#8e939c 25%,#ffffff 45%,#5f6570 65%,#dfe2e7 85%,#8e939c)}",
      ".rb-f-argent .rb-art{background:#191b20}",
      ".rb-f-argent::after{background-image:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.32) 46%,rgba(210,218,230,.18) 52%,transparent 68%);mix-blend-mode:screen}",
      ".rb-f-or{--rb-frame:linear-gradient(135deg,#f6e7b0,#c9a45c 25%,#fff6d8 45%,#8a6a2a 65%,#e9cf86 85%,#a8833d);box-shadow:0 0 22px rgba(201,164,92,.3)}",
      ".rb-f-or .rb-art{background:#1e1912}",
      ".rb-f-or::after{background-image:linear-gradient(115deg,transparent 25%,rgba(233,200,110,.35) 42%,rgba(255,246,216,.5) 50%,rgba(233,200,110,.35) 58%,transparent 75%);mix-blend-mode:overlay;animation-duration:4s}",
      ".rb-f-foil{--rb-frame:conic-gradient(from 210deg,#d9779b,#e6c27a,#86d6b4,#7fb6e6,#a98be0,#d9779b);box-shadow:0 0 26px rgba(169,139,224,.32)}",
      ".rb-f-foil .rb-art{background:#1a1420}",
      ".rb-f-foil::after{background-image:repeating-linear-gradient(115deg,#d9779b 0%,#e6c27a 7%,#86d6b4 14%,#7fb6e6 21%,#a98be0 28%,#d9779b 35%),radial-gradient(circle at var(--mx) var(--my),rgba(255,255,255,.45),transparent 50%);background-size:300% 300%,100% 100%;mix-blend-mode:color-dodge;opacity:.3;animation-duration:7s}",
      ".rb-live::after{animation:none;background-position:var(--mx) var(--my),center}",
      "@keyframes rb-foil{0%,100%{background-position:0% 0%,center}50%{background-position:100% 100%,center}}",

      /* Collection */
      ".rb-col-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px}",
      ".rb-progress{display:flex;flex-direction:column;align-items:flex-end;gap:10px;width:220px;max-width:100%}",
      ".rb-progress-bar{width:100%;height:3px;border-radius:2px;background:color-mix(in srgb,var(--rb-text) 10%,transparent);overflow:hidden}",
      ".rb-progress-bar i{display:block;height:100%;background:var(--rb-gilt)}",
      ".rb-pills{display:flex;flex-wrap:wrap;gap:8px}",
      ".rb-pill{min-height:36px;padding:0 14px;border-radius:999px;border:1px solid color-mix(in srgb,var(--rb-text) 16%,transparent);background:transparent;color:var(--rb-muted);font:600 10.5px/1 var(--rb-font);letter-spacing:.16em;text-transform:uppercase;cursor:pointer}",
      ".rb-pill:hover{color:var(--rb-text);border-color:color-mix(in srgb,var(--rb-text) 35%,transparent)}",
      ".rb-pill-on,.rb-pill-on:hover{background:var(--rb-accent);border-color:var(--rb-accent);color:#f3ede4}",
      ".rb-groups{display:flex;flex-direction:column}",
      ".rb-group{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 20px;align-items:center;padding:14px 0;border-top:1px solid var(--rb-line)}",
      ".rb-group-name{font-size:19px}",
      ".rb-group-cards{display:grid;grid-template-columns:repeat(var(--rb-n,4),72px);gap:10px}",
      ".rb-mini{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0}",
      ".rb-mini .rb-cap{display:none}.rb-mini .rb-card::before{padding:3px}.rb-mini .rb-qty{top:5px;left:5px;padding:2px 5px;font-size:10px}",
      ".rb-mini .rb-missing{border-radius:8px}.rb-mini .rb-missing-q{font-size:20px}",
      ".rb-mini-r{max-width:100%;font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--rb-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "@container (max-width:520px){.rb-group{grid-template-columns:1fr}.rb-group-cards{grid-template-columns:repeat(var(--rb-n,4),minmax(0,92px))}}",
      ".rb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:18px}",
      ".rb-tile{display:block;width:100%;aspect-ratio:7/10;padding:0;border:0;background:none;cursor:zoom-in;transition:transform .2s ease}",
      ".rb-tile:hover{transform:translateY(-6px)}",
      ".rb-missing{width:100%;aspect-ratio:7/10;border:1px dashed color-mix(in srgb,var(--rb-text) 18%,transparent);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}",
      ".rb-missing-q{font-family:var(--rb-display);font-size:30px;color:color-mix(in srgb,var(--rb-text) 30%,transparent)}",
      ".rb-missing .rb-label{font-size:9px;color:#8c847d}",

      /* Zoom 350x500 */
      ".rb.rb-zoom{--rb-text:#ece6dc;--rb-muted:#a39a91;--rb-line:rgba(236,230,220,.12);border:0;position:fixed;inset:0;z-index:99999;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px 48px;padding:24px;border-radius:0;background:rgba(8,6,9,.92);overflow:auto;animation:rb-fade .2s ease-out}",
      ".rb-zoom-card{width:min(350px,80vw,calc((100vh - 140px)*.7));aspect-ratio:7/10;animation:rb-pop .3s cubic-bezier(.2,.8,.3,1)}",
      ".rb-zoom-info{width:min(280px,80vw);display:flex;flex-direction:column;gap:14px}",
      "@keyframes rb-fade{from{opacity:0}}",
      "@keyframes rb-pop{from{opacity:0;transform:scale(.92)}}",

      /* Panneau staff */
      ".rb-scroll{overflow-x:auto}",
      ".rb-table{width:100%;border-collapse:collapse;font-size:14px}",
      ".rb-table th{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--rb-muted)}",
      ".rb-table th,.rb-table td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--rb-line);vertical-align:middle}",
      ".rb-tag{display:inline-block;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:600}",
      ".rb-tag-wait{background:rgba(201,164,92,.15);color:#e2c483}",
      ".rb-tag-ok{background:rgba(134,214,180,.12);color:#9fe0c4}",

      "@media (prefers-reduced-motion:reduce){.rb *,.rb *::before,.rb *::after,.rb.rb-zoom{animation:none!important;transition:none!important}}"
    ].join("\n");
    var style = document.createElement("style");
    style.id = "rb-styles-v5";
    style.textContent = css;
    document.head.appendChild(style);
    initGlobals();
  }

  // ---------------------------------------------------------------------------
  // Rendu des cartes
  // ---------------------------------------------------------------------------

  var FINISHES = { normal: 1, argent: 1, or: 1, foil: 1 };
  var FINISH_TEXT = { normal: "#a39a91", argent: "#c9ccd3", or: "#d9b871", foil: "#c7a6f0" };

  function finishOf(card, rarity) {
    var f = card.finish || (rarity && rarity.finish) || "normal";
    return FINISHES[f] ? f : "normal";
  }

  // Une carte, face visible. extra = badges (Nouveau, ×2…)
  function cardHtml(cat, card, extra) {
    var r = cat.rarityById[card.rarity];
    var img = safeUrl(card.image);
    return '<div class="rb-card rb-tilt rb-f-' + finishOf(card, r) + '" style="--rb-c:' + esc(r && r.color || "#8a9099") + '">' +
      // L'illustration est le fond d'un rectangle plus grand que la carte (aucune règle img du site ne peut le rétrécir)
      '<div class="rb-media">' + (img
        ? '<div class="rb-art rb-art-img" role="presentation" style="background:#17131a url(\'' + esc(img.replace(/'/g, "%27")) + '\') center / cover no-repeat"></div>'
        : '<div class="rb-art"></div>') + '</div>' +
      (CONFIG.SHOW_CARD_TEXT || !img
        ? '<div class="rb-cap"><div class="rb-nm">' + esc(card.name) + '</div><div class="rb-rr">' + esc(r ? r.label : card.rarity) + '</div></div>'
        : "") +
      (extra || "") + '</div>';
  }

  function rarityLabel(cat, card) {
    var r = cat.rarityById[card.rarity];
    return '<div class="rb-label" style="color:' + FINISH_TEXT[finishOf(card, r)] + '">' + esc(r ? r.label : card.rarity) + '</div>';
  }

  // Le booster scellé (dessiné en CSS + SVG)
  function packHtml(cat, enabled) {
    var petals = "";
    for (var a = 0; a < 180; a += 45) {
      petals += '<ellipse cx="48" cy="27" rx="7" ry="13" transform="rotate(' + a + ' 48 48)"></ellipse>' +
        '<ellipse cx="48" cy="69" rx="7" ry="13" transform="rotate(' + a + ' 48 48)"></ellipse>';
    }
    return '<button type="button" class="rb-pack" data-act="open"' + (enabled ? "" : " disabled") + ' aria-label="Ouvrir le booster">' +
      '<div class="rb-pack-body"><div class="rb-pack-sheen"></div><div class="rb-pack-frame"></div><div class="rb-pack-frame"></div>' +
      '<div class="rb-pack-center">' +
      '<svg width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' +
      '<circle cx="48" cy="48" r="44"></circle><circle cx="48" cy="48" r="38" stroke-opacity=".45"></circle><circle cx="48" cy="48" r="9"></circle>' + petals + '</svg>' +
      '<div class="rb-pack-text"><div class="rb-pack-name">' + esc(CONFIG.PACK_NAME) + '</div><div class="rb-pack-count">' + cat.packSize + ' cartes</div></div>' +
      '</div></div>' +
      '<div class="rb-pack-cap"><div class="rb-pack-perf"></div></div>' +
      '</button>';
  }

  // Collection : en-tête avec progression, filtres (optionnels), grille
  function collectionHtml(cat, owned, opts) {
    var qtyById = {};
    owned.forEach(function (o) { qtyById[o.cardId] = o.qty; });
    var ownedCount = cat.cards.filter(function (c) { return qtyById[c.id]; }).length;
    var total = cat.cards.length;

    var cards = cat.cards.filter(function (c) {
      return (opts.showMissing || qtyById[c.id]) && (!opts.filter || opts.filter === "all" || c.rarity === opts.filter);
    });
    if (!opts.showMissing) {
      cards.sort(function (a, b) { return cat.rarityById[b.rarity].rank - cat.rarityById[a.rarity].rank; });
    }

    var html = '<div class="rb-col-head"><div class="rb-stack">' +
      (opts.kicker ? '<div class="rb-label">' + esc(opts.kicker) + '</div>' : "") +
      '<div class="rb-display rb-subtitle" role="heading" aria-level="3">' + esc(opts.title) + '</div></div>' +
      '<div class="rb-progress"><div class="rb-muted" style="font-size:14px"><b style="color:var(--rb-text);font-weight:600">' + ownedCount + '</b> / ' + total + ' cartes</div>' +
      '<div class="rb-progress-bar"><i style="width:' + Math.round(100 * ownedCount / Math.max(total, 1)) + '%"></i></div></div></div>';

    var isGrouped = cat.cards.some(function (c, i) { return cat.cards.findIndex(function (d) { return d.name === c.name; }) !== i; });
    if (opts.filters && !isGrouped) {
      html += '<div class="rb-pills">' + [{ id: "all", label: "Toutes" }].concat(cat.rarities).map(function (r) {
        var on = (opts.filter || "all") === r.id;
        return '<button type="button" class="rb-pill' + (on ? " rb-pill-on" : "") + '" data-act="filter" data-f="' + esc(r.id) + '" aria-pressed="' + on + '">' + esc(r.label) + '</button>';
      }).join("") + '</div>';
    }

    // Plusieurs cartes du même nom (un personnage en plusieurs raretés) : une ligne par personnage
    var groups = [], byName = {};
    cat.cards.forEach(function (c) {
      if (!byName[c.name]) { byName[c.name] = { name: c.name, desc: c.description, cards: [] }; groups.push(byName[c.name]); }
      byName[c.name].cards.push(c);
    });
    if (groups.length < cat.cards.length) {
      groups = groups.filter(function (g) { return opts.showMissing || g.cards.some(function (c) { return qtyById[c.id]; }); });
      if (!groups.length) return html + '<p class="rb-muted">Aucune carte pour l\'instant.</p>';
      return html + '<div class="rb-groups">' + groups.map(function (g) {
        var have = g.cards.filter(function (c) { return qtyById[c.id]; }).length;
        return '<div class="rb-group"><div class="rb-stack" style="gap:4px;min-width:0">' +
          '<div class="rb-display rb-group-name">' + esc(g.name) + '</div>' +
          '<div class="rb-label" style="font-size:10px">' + (g.desc ? esc(g.desc) + ' · ' : "") + have + ' / ' + g.cards.length + '</div></div>' +
          '<div class="rb-group-cards" style="--rb-n:' + g.cards.length + '">' + g.cards.map(function (c) {
            var r = cat.rarityById[c.rarity], label = esc(r ? r.label : c.rarity), qty = qtyById[c.id] || 0;
            var inner = qty
              ? '<button type="button" class="rb-tile" data-rb-zoom="' + esc(c.id) + '" data-qty="' + qty + '" aria-label="Agrandir ' + esc(c.name) + ', ' + label + '">' +
                cardHtml(cat, c, qty > 1 ? '<span class="rb-qty">×' + qty + '</span>' : "") + '</button>'
              : '<div class="rb-missing" role="img" aria-label="' + label + ', pas encore obtenue"><div class="rb-missing-q" aria-hidden="true">?</div></div>';
            return '<div class="rb-mini">' + inner + '<div class="rb-mini-r">' + label + '</div></div>';
          }).join("") + '</div></div>';
      }).join("") + '</div>';
    }

    if (!cards.length) return html + '<p class="rb-muted">Aucune carte ici pour l\'instant.</p>';

    return html + '<div class="rb-grid">' + cards.map(function (c) {
      var qty = qtyById[c.id] || 0;
      if (!qty) {
        var r = cat.rarityById[c.rarity];
        return '<div class="rb-missing"><div class="rb-missing-q" aria-hidden="true">?</div><div class="rb-label">' + esc(r ? r.label : c.rarity) + '</div></div>';
      }
      return '<button type="button" class="rb-tile" data-rb-zoom="' + esc(c.id) + '" data-qty="' + qty + '" aria-label="Agrandir ' + esc(c.name) + '">' +
        cardHtml(cat, c, qty > 1 ? '<span class="rb-qty">×' + qty + '</span>' : "") + '</button>';
    }).join("") + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Page du jeu
  // ---------------------------------------------------------------------------

  function mountGame(zone) {
    injectStyles(zone);
    var member = R.member, character = R.character;
    zone.dataset.rbFor = (member ? member.login : "") + "|" + (character ? character.id : "");

    function simple(text) { zone.innerHTML = '<div class="rb"><div class="rb-display rb-title" role="heading" aria-level="2">Boosters</div><p class="rb-muted">' + text + '</p></div>'; }
    if (!member) { simple("Connecte-toi pour ouvrir des boosters."); return; }
    if (!character) { simple("Choisis un personnage pour ouvrir des boosters."); return; }

    var key = codeKey(character.id);
    // phase : idle (booster scellé) | opening (appel en cours) | open (pile) | done (pile vide)
    var state = { cat: null, status: null, owned: [], phase: "idle", pack: null, message: "", newCode: "", filter: "all" };

    simple("Chargement des boosters…");

    function canOpen() {
      var s = state.status;
      return !!s && s.approved && (s.freeAvailable || s.bonusTickets > 0);
    }

    function headHtml(name) {
      var s = state.status;
      var chips = "";
      if (s && s.approved) {
        var daily = s.freeAvailable ? "Disponible" : fmtNextFree(s.nextFreeAt);
        chips = '<div class="rb-chips">' +
          '<div class="rb-chip"><span class="rb-label" style="font-size:10px">Booster du jour</span><b>' + esc(daily.charAt(0).toUpperCase() + daily.slice(1)) + '</b></div>' +
          '<div class="rb-chip"><span class="rb-label" style="font-size:10px">Tickets bonus</span><b>' + s.bonusTickets + '</b></div></div>';
      }
      return '<div class="rb-head"><div class="rb-stack"><div class="rb-label">' + esc(name) + '</div>' +
        '<div class="rb-display rb-title" role="heading" aria-level="2">Boosters</div></div>' + chips + '</div><div class="rb-rule"></div>';
    }

    function render() {
      var code = store.get(key) || (state.cat && state.cat.openMode ? "open" : null);
      var html = "";
      if (state.message) html += '<div class="rb-box rb-error" role="alert">' + esc(state.message) + '</div>';

      if (state.newCode) {
        html = headHtml(character.name) + html +
          '<div class="rb-box rb-stack" style="gap:10px"><p>Inscription envoyée. Voici ton code joueur :</p>' +
          '<p class="rb-code">' + esc(state.newCode) + '</p>' +
          '<p class="rb-muted">Note-le quelque part : il te servira si tu changes de navigateur ou d\'appareil.</p>' +
          '<div class="rb-row" style="margin-top:8px"><button type="button" class="rb-btn rb-btn-main" data-act="continue">C\'est noté</button></div></div>';
      } else if (!code) {
        html = headHtml(character.name) + html +
          '<p>Pour jouer avec <strong>' + esc(character.name) + '</strong>, inscris ce personnage. Le staff validera ensuite ton inscription.</p>' +
          '<div class="rb-row"><button type="button" class="rb-btn rb-btn-main" data-act="register">Inscrire ' + esc(character.name) + '</button></div>' +
          '<details><summary>J\'ai déjà un code</summary><div class="rb-row" style="margin-top:12px">' +
          '<label class="rb-row" style="gap:10px">Code joueur <input class="rb-input" name="rb-code" autocomplete="off" placeholder="XXXXX-XXXXX"></label>' +
          '<button type="button" class="rb-btn" data-act="use-code">Valider</button></div></details>';
      } else if (state.status && state.cat) {
        var s = state.status;
        html = headHtml(s.name) + html;
        var colHtml = collectionHtml(state.cat, state.owned, { title: "Collection", filters: true, filter: state.filter, showMissing: true });
        if (!s.approved) {
          html += '<div class="rb-box">Ton inscription attend la validation du staff. Reviens un peu plus tard !</div>' +
            '<div class="rb-rule" style="opacity:.25"></div>' + colHtml;
        } else if (state.phase === "open" || state.phase === "done") {
          html += openHtml(state.fresh) + '<div class="rb-rule" style="opacity:.25"></div>' + colHtml;
          state.fresh = false;
        } else {
          // Paquet fermé : booster à gauche, collection à droite
          html += '<div class="rb-layout"><div class="rb-side"><div class="rb-stage">' + packHtml(state.cat, canOpen()) +
            '<div class="rb-stack" style="align-items:center">' +
            (canOpen()
              ? '<p>Clique sur le booster pour l\'ouvrir</p><p class="rb-muted" style="font-size:13px">' + state.cat.packSize + ' cartes, dont au moins une ' + esc(guaranteedLabel()) + '</p>'
              : '<p>Plus de booster pour aujourd\'hui</p><p class="rb-muted" style="font-size:13px">Prochain booster gratuit : ' + esc(fmtNextFree(s.nextFreeAt)) + '</p>') +
            '</div></div></div><div class="rb-main">' + colHtml + '</div></div>';
        }
      } else {
        html = headHtml(character.name) + html;
      }
      zone.innerHTML = '<div class="rb">' + html + '</div>';
    }

    // Identification : par le personnage connecté (mode ouvert) ou par le code joueur
    function auth() {
      if (state.cat && state.cat.openMode) return { who: { id: character.id, name: character.name, slug: character.slug } };
      var code = store.get(key);
      return code ? { code: code } : null;
    }

    function guaranteedLabel() {
      var r = state.cat.rarityById[state.cat.guaranteedMinRarity];
      return r ? r.label.toLowerCase() : "";
    }

    // ---- Booster ouvert : rendu complet (utilisé après un rechargement de l'affichage) ----

    // fresh = juste après l'ouverture : la pile arrive en animation ; sinon tout est déjà en place
    function openHtml(fresh) {
      var p = state.pack, cat = state.cat;
      var remaining = p.cards.length - p.drawn;
      var backs = "";
      for (var i = 0; i < remaining; i++) backs += backHtml(i, fresh);
      var revealed = p.cards.slice(0, p.drawn).map(function (c) { return revealedHtml(c, true); }).join("");
      return '<div class="rb-open" data-open>' +
        '<div class="rb-pile-col">' +
        (remaining ? '<button type="button" class="rb-pile" data-act="draw" aria-label="Tirer la carte suivante">' + backs + '</button>' : '<div class="rb-pile-empty"></div>') +
        '<div class="rb-label" data-remaining>' + remainingLabel(remaining) + '</div></div>' +
        '<div class="rb-reveal-col"><div class="rb-slot" data-slot>' +
        (p.drawn ? revealed : '<div class="rb-slot-empty">Tire une carte de la pile</div>') + '</div></div>' +
        '<div class="rb-info" data-info aria-live="polite">' + infoHtml() + '</div>' +
        '</div>' +
        '<div class="rb-draws"><div class="rb-label" style="font-size:10px">Tirage</div><div class="rb-slots" data-slots>' +
        p.cards.map(function (c, i) { return i < p.drawn ? cardHtml(cat, c) : '<div class="rb-thumb-empty"></div>'; }).join("") +
        '</div></div>';
    }

    function backHtml(i, fresh) {
      return '<div class="rb-back" style="left:' + (12 + i * 3) + 'px;top:' + (8 - i * 3) + 'px;' +
        (fresh ? 'animation-delay:' + (i * 0.06).toFixed(2) + 's' : 'animation:none') + '"></div>';
    }

    function revealedHtml(c, still) {
      return '<button type="button" class="rb-revealed"' + (still ? ' style="animation:none"' : "") + ' data-rb-zoom="' + esc(c.id) + '" aria-label="Agrandir ' + esc(c.name) + '">' +
        cardHtml(state.cat, c, c.isNew ? '<span class="rb-new">Nouveau</span>' : "") + '</button>';
    }

    function remainingLabel(n) {
      return n ? n + " carte" + (n > 1 ? "s" : "") + " restante" + (n > 1 ? "s" : "") : "Pile vide";
    }

    function infoHtml() {
      var p = state.pack, cat = state.cat, total = p.cards.length;
      if (!p.drawn) {
        return '<p class="rb-muted">Le booster est ouvert. Clique sur la pile pour tirer les cartes une à une.</p>';
      }
      var c = p.cards[p.drawn - 1];
      var html = rarityLabel(cat, c) +
        '<div class="rb-display" style="font-size:34px">' + esc(c.name) + '</div>' +
        (c.isNew ? '<div class="rb-new-badge">Nouvelle carte</div>' : "") +
        (c.description ? '<p class="rb-muted" style="font-size:14px;line-height:1.6">' + esc(c.description) + '</p>' : "");
      if (p.drawn < total) {
        html += '<p class="rb-muted" style="font-size:13px">Carte ' + p.drawn + ' sur ' + total + '. Clique sur la pile pour la suivante.</p>';
      } else {
        var news = p.cards.filter(function (x) { return x.isNew; }).length;
        html += '<div class="rb-info-actions"><p class="rb-muted" style="font-size:14px">Booster terminé : ' +
          (news ? news + " nouvelle" + (news > 1 ? "s" : "") + " carte" + (news > 1 ? "s" : "") : "aucune nouvelle carte") + '.</p>' +
          '<button type="button" class="rb-btn rb-btn-main" data-act="done">Ranger dans la collection</button></div>';
      }
      return html;
    }

    // ---- Tirer une carte : mise à jour ciblée pour que les animations se jouent ----

    function drawOne() {
      var p = state.pack;
      if (!p || p.drawn >= p.cards.length) return;
      var card = p.cards[p.drawn];
      p.drawn++;
      var remaining = p.cards.length - p.drawn;

      var pile = zone.querySelector(".rb-pile");
      if (pile && pile.lastElementChild) pile.lastElementChild.remove();
      if (!remaining && pile) {
        var empty = document.createElement("div");
        empty.className = "rb-pile-empty";
        pile.replaceWith(empty);
      }
      zone.querySelector("[data-remaining]").textContent = remainingLabel(remaining);

      var slot = zone.querySelector("[data-slot]");
      var placeholder = slot.querySelector(".rb-slot-empty");
      if (placeholder) placeholder.remove();
      slot.insertAdjacentHTML("beforeend", revealedHtml(card));

      var thumbs = zone.querySelector("[data-slots]");
      var thumb = thumbs.children[p.drawn - 1];
      if (thumb) {
        thumb.insertAdjacentHTML("afterend", cardHtml(state.cat, card));
        thumb.nextElementSibling.classList.add("rb-slot-in");
        thumb.remove();
      }

      zone.querySelector("[data-info]").innerHTML = infoHtml();
      if (!remaining) {
        state.phase = "done";
        var doneBtn = zone.querySelector('[data-act="done"]');
        if (doneBtn) doneBtn.focus();
      }
    }

    function load() {
      return catalog().then(function (cat) {
        state.cat = cat;
        var a = auth();
        return a ? api("/me", a) : null;
      }).then(function (me) {
        if (me) { state.status = me.status; state.owned = me.owned; }
        render();
      }).catch(function (e) {
        if (e.status === 401) { store.del(key); state.message = "Ce code n'est plus valide. Inscris-toi ou saisis un nouveau code."; }
        else state.message = e.message;
        render();
      });
    }

    // Ouverture : le booster tremble pendant l'appel (ce qui masque aussi le réveil du serveur),
    // puis se déchire et laisse place à la pile.
    function open(btn) {
      if (state.phase !== "idle") return;
      state.phase = "opening";
      state.message = "";
      btn.classList.add("rb-pack-wait");
      var a = auth();
      a.method = "POST";
      Promise.all([api("/open", a), wait(700)]).then(function (res) {
        var data = res[0];
        state.status = data.status;
        btn.classList.remove("rb-pack-wait");
        btn.classList.add("rb-tearing");
        return wait(950).then(function () {
          state.pack = { cards: data.cards, drawn: 0 };
          state.phase = "open";
          state.fresh = true;
          render();
          var pile = zone.querySelector(".rb-pile");
          if (pile) pile.focus();
        });
      }).catch(function (e) {
        state.phase = "idle";
        state.message = e.message;
        load();
      });
    }

    function finish() {
      // La collection n'est mise à jour qu'ici, pour ne rien gâcher pendant le tirage
      var byId = {};
      state.owned.forEach(function (o) { byId[o.cardId] = o; });
      (state.pack ? state.pack.cards : []).forEach(function (c) {
        if (byId[c.id]) byId[c.id].qty++;
        else { byId[c.id] = { cardId: c.id, qty: 1 }; state.owned.push(byId[c.id]); }
      });
      state.pack = null;
      state.phase = "idle";
      render();
    }

    if (!zone.dataset.rbBound) {
      zone.dataset.rbBound = "1";
      zone.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-act]");
        if (!btn || !zone.contains(btn) || btn.disabled) return;
        if (zone._rbAction) zone._rbAction(btn.getAttribute("data-act"), btn);
      });
    }

    zone._rbAction = function (act, btn) {
      if (act === "register") {
        btn.disabled = true;
        api("/register", { method: "POST", body: { characterId: String(character.id), slug: character.slug || "", name: character.name } })
          .then(function (res) { store.set(key, res.code); state.newCode = res.code; state.message = ""; render(); })
          .catch(function (e) { state.message = e.message; render(); });
      } else if (act === "use-code") {
        var input = zone.querySelector('input[name="rb-code"]');
        var value = input ? input.value.trim() : "";
        if (!value) return;
        store.set(key, value);
        state.message = "";
        load();
      } else if (act === "continue") {
        state.newCode = "";
        load();
      } else if (act === "open") {
        open(btn);
      } else if (act === "draw") {
        drawOne();
      } else if (act === "done") {
        finish();
      } else if (act === "filter") {
        state.filter = btn.getAttribute("data-f");
        var focusId = state.filter;
        render();
        var again = zone.querySelector('[data-act="filter"][data-f="' + CSS.escape(focusId) + '"]');
        if (again) again.focus();
      }
    };

    load();
  }

  // ---------------------------------------------------------------------------
  // Panneau staff
  // ---------------------------------------------------------------------------

  function mountAdmin(zone) {
    injectStyles(zone);
    zone.dataset.rbFor = "admin";
    var state = { players: null, message: "", notes: {}, confirmDelete: null };

    function render() {
      var key = store.get(ADMIN_KEY_STORE);
      var html = '<div class="rb"><div class="rb-stack"><div class="rb-label">Panneau staff</div><div class="rb-display rb-title" role="heading" aria-level="2">Boosters</div></div><div class="rb-rule"></div>';
      if (state.message) html += '<div class="rb-box rb-error" role="alert">' + esc(state.message) + '</div>';

      if (!key) {
        html += '<div class="rb-row"><label class="rb-row" style="gap:10px">Clé staff <input class="rb-input" type="password" name="rb-admin-key" autocomplete="off"></label>' +
          '<button class="rb-btn rb-btn-main" data-act="save-key">Se connecter</button></div>' +
          '<p class="rb-muted">C\'est la valeur de ADMIN_KEY dans les réglages Vercel. Elle reste dans ce navigateur.</p>';
      } else if (!state.players) {
        html += '<p class="rb-muted">Chargement…</p>';
      } else {
        html += '<div class="rb-row">' +
          '<label class="rb-row" style="gap:8px">Donner <input class="rb-input" type="number" name="rb-all" value="1" min="-50" max="50" style="width:80px"> ticket(s) à tous les joueurs validés</label>' +
          '<button class="rb-btn" data-act="give-all">Distribuer</button>' +
          '<button class="rb-btn" data-act="refresh">Actualiser</button>' +
          '<button class="rb-btn" data-act="forget-key">Oublier la clé</button></div>' +
          '<p class="rb-muted">Avant de valider une inscription, vérifie en MP qu\'elle vient bien du joueur de ce personnage.</p>';
        if (!state.players.length) {
          html += '<p>Aucun joueur inscrit pour l\'instant.</p>';
        } else {
          html += '<div class="rb-scroll"><table class="rb-table"><thead><tr><th>Personnage</th><th>Statut</th><th>Gratuit</th><th>Tickets</th><th>Cartes</th><th>Dernière ouverture</th><th>Actions</th></tr></thead><tbody>' +
            state.players.map(function (p) {
              var note = state.notes[p.id] ? '<div class="rb-code" style="font-size:14px;margin-top:6px">' + esc(state.notes[p.id]) + '</div>' : "";
              return '<tr><td><strong>' + esc(p.name) + '</strong><div class="rb-muted" style="font-size:.85em">' + esc(p.slug || "") + ' · id ' + esc(p.characterId) + '</div>' + note + '</td>' +
                '<td>' + (p.approved ? '<span class="rb-tag rb-tag-ok">Validé</span>' : '<span class="rb-tag rb-tag-wait">En attente</span>') + '</td>' +
                '<td>' + (p.freeAvailable ? "Dispo" : "Utilisé") + '</td>' +
                '<td>' + p.bonusTickets + '</td>' +
                '<td>' + p.unique + '</td>' +
                '<td>' + (p.lastOpening ? esc(new Date(p.lastOpening).toLocaleString("fr-FR")) : "—") + '</td>' +
                '<td><div class="rb-row" style="gap:6px">' +
                (p.approved ? "" : '<button class="rb-btn rb-btn-sm rb-btn-main" data-act="approve" data-id="' + p.id + '">Valider</button>') +
                '<button class="rb-btn rb-btn-sm" data-act="tickets" data-n="1" data-id="' + p.id + '" aria-label="Ajouter un ticket à ' + esc(p.name) + '">+1</button>' +
                '<button class="rb-btn rb-btn-sm" data-act="tickets" data-n="-1" data-id="' + p.id + '" aria-label="Retirer un ticket à ' + esc(p.name) + '">−1</button>' +
                '<button class="rb-btn rb-btn-sm" data-act="reset-code" data-id="' + p.id + '">Nouveau code</button>' +
                '<button class="rb-btn rb-btn-sm" data-act="delete" data-id="' + p.id + '">' + (state.confirmDelete === p.id ? "Confirmer la suppression" : "Supprimer") + '</button>' +
                '</div></td></tr>';
            }).join("") + '</tbody></table></div>';
        }
      }
      html += '</div>';
      zone.innerHTML = html;
    }

    function call(path, opts) {
      opts = opts || {};
      opts.admin = store.get(ADMIN_KEY_STORE);
      return api(path, opts).catch(function (e) {
        if (e.status === 401) { store.del(ADMIN_KEY_STORE); state.players = null; }
        throw e;
      });
    }

    function load() {
      if (!store.get(ADMIN_KEY_STORE)) { render(); return; }
      render();
      call("/admin/players").then(function (list) { state.players = list; render(); })
        .catch(function (e) { state.message = e.message; render(); });
    }

    function then(promise) {
      promise.then(function () { state.message = ""; load(); })
        .catch(function (e) { state.message = e.message; load(); });
    }

    zone.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-act]");
      if (!btn || !zone.contains(btn) || btn.disabled) return;
      var act = btn.getAttribute("data-act");
      var id = Number(btn.getAttribute("data-id"));
      if (act !== "delete") state.confirmDelete = null;

      if (act === "save-key") {
        var input = zone.querySelector('input[name="rb-admin-key"]');
        if (input && input.value) { store.set(ADMIN_KEY_STORE, input.value); state.message = ""; load(); }
      } else if (act === "forget-key") {
        store.del(ADMIN_KEY_STORE); state.players = null; render();
      } else if (act === "refresh") {
        load();
      } else if (act === "give-all") {
        var n = parseInt(zone.querySelector('input[name="rb-all"]').value, 10);
        if (n) then(call("/admin/tickets", { method: "POST", body: { amount: n } }));
      } else if (act === "approve") {
        then(call("/admin/players/" + id + "/approve", { method: "POST" }));
      } else if (act === "tickets") {
        then(call("/admin/players/" + id + "/tickets", { method: "POST", body: { amount: Number(btn.getAttribute("data-n")) } }));
      } else if (act === "reset-code") {
        call("/admin/players/" + id + "/reset-code", { method: "POST" }).then(function (res) {
          state.notes[id] = "Nouveau code à envoyer en MP : " + res.code;
          render();
        }).catch(function (e) { state.message = e.message; render(); });
      } else if (act === "delete") {
        if (state.confirmDelete !== id) { state.confirmDelete = id; render(); return; }
        state.confirmDelete = null;
        then(call("/admin/players/" + id, { method: "DELETE" }));
      }
    });

    load();
  }

  // ---------------------------------------------------------------------------
  // Zoom 350x500 et reflets qui suivent la souris
  // ---------------------------------------------------------------------------

  function openZoom(cat, card, qty, origin) {
    var overlay = document.createElement("div");
    overlay.className = "rb rb-zoom";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", card.name);
    overlay.innerHTML = '<div class="rb-zoom-card">' + cardHtml(cat, card) + '</div>' +
      '<div class="rb-zoom-info">' +
      '<div class="rb-label">' + esc((cat.rarityById[card.rarity] || {}).label || card.rarity) +
      (qty ? " · " + qty + " exemplaire" + (qty > 1 ? "s" : "") : "") + '</div>' +
      '<div class="rb-display" style="font-size:40px">' + esc(card.name) + '</div>' +
      (card.description ? '<p class="rb-muted" style="font-size:14px;line-height:1.6">' + esc(card.description) + '</p>' : "") +
      '<button type="button" class="rb-btn" style="align-self:flex-start;margin-top:8px" data-rb-close>Fermer</button>' +
      '</div>';

    function close() {
      overlay.remove();
      if (origin && origin.focus) origin.focus();
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest("[data-rb-close]")) close();
    });
    overlay.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    document.body.appendChild(overlay);
    overlay.querySelector("[data-rb-close]").focus();
  }

  var globalsReady = false;
  function initGlobals() {
    if (globalsReady) return;
    globalsReady = true;

    document.addEventListener("click", function (e) {
      var el = e.target.closest && e.target.closest("[data-rb-zoom]");
      if (!el || el.closest(".rb-zoom")) return;
      catalog().then(function (cat) {
        var card = cat.cardById[el.getAttribute("data-rb-zoom")];
        if (card) openZoom(cat, card, Number(el.getAttribute("data-qty") || 0), el);
      });
    });

    var tilt = window.matchMedia && matchMedia("(pointer: fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!tilt) return;
    var live = null;
    function reset() {
      if (!live) return;
      ["--mx", "--my", "--rx", "--ry"].forEach(function (v) { live.style.removeProperty(v); });
      live.classList.remove("rb-live");
      live = null;
    }
    document.addEventListener("pointermove", function (e) {
      var c = e.target.closest && e.target.closest(".rb-tilt");
      if (c && c.closest(".rb-slots")) c = null; // pas d'effet sur les miniatures
      if (c !== live) reset();
      if (!c) return;
      live = c;
      var b = c.getBoundingClientRect();
      var x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
      c.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
      c.style.setProperty("--my", (y * 100).toFixed(1) + "%");
      c.style.setProperty("--ry", ((x - 0.5) * 14).toFixed(2) + "deg");
      c.style.setProperty("--rx", ((0.5 - y) * 14).toFixed(2) + "deg");
      c.classList.add("rb-live");
    });
    document.addEventListener("pointerout", function (e) { if (!e.relatedTarget) reset(); });
  }

  // ---------------------------------------------------------------------------
  // Collection sur les profils
  // ---------------------------------------------------------------------------

  function profileSlug() {
    var page = R.page || {};
    if (!/charact|personn|personaj/i.test(page.route || "")) return null;
    var params = page.params || {};
    return params.slug || params.character || params.characterSlug || null;
  }

  var profileLoading = null;
  function mountProfile() {
    if (!CONFIG.PROFILE_ENABLED) return true;
    var slug = profileSlug();
    var existing = document.querySelector(".rb-profile");
    if (existing && existing.dataset.slug !== slug) existing.remove();
    if (!slug) return true;
    if ((existing && existing.dataset.slug === slug) || profileLoading === slug) return true;
    var target = document.querySelector(CONFIG.PROFILE_TARGET);
    if (!target) return false; // la page n'est pas encore dessinée : on réessaiera

    injectStyles(target);
    profileLoading = slug;
    Promise.all([catalog(), api("/collection/" + encodeURIComponent(slug))]).then(function (res) {
      profileLoading = null;
      if (profileSlug() !== slug || document.querySelector('.rb-profile[data-slug="' + CSS.escape(slug) + '"]')) return;
      var cat = res[0], col = res[1];
      var section = document.createElement("section");
      section.className = "rb rb-profile";
      section.dataset.slug = slug;
      section.innerHTML = collectionHtml(cat, col.owned, { kicker: col.name, title: "Cartes", showMissing: false });
      (document.querySelector(CONFIG.PROFILE_TARGET) || target).appendChild(section);
    }, function () { profileLoading = null; }); // 404 = ce personnage ne joue pas : on n'affiche rien
    return true;
  }

  // ---------------------------------------------------------------------------
  // Démarrage : Rolea change de page sans recharger, on réessaie à chaque navigation
  // ---------------------------------------------------------------------------

  function tick() {
    var done = true;
    var game = document.getElementById(CONFIG.GAME_ZONE);
    if (game) {
      var who = (R.member ? R.member.login : "") + "|" + (R.character ? R.character.id : "");
      if (game.dataset.rbFor !== who) mountGame(game);
    } else done = false;

    var adminZone = document.getElementById(CONFIG.ADMIN_ZONE);
    if (adminZone && adminZone.dataset.rbFor !== "admin") mountAdmin(adminZone);

    if (!mountProfile()) done = false;
    return done;
  }

  var timer = null;
  function schedule() {
    clearInterval(timer);
    var tries = 0;
    if (tick()) return;
    timer = setInterval(function () {
      if (tick() || ++tries > 20) clearInterval(timer);
    }, 250);
  }

  R.on("page", function (page) {
    if (CONFIG.DEBUG) console.log("[booster] R.page =", JSON.parse(JSON.stringify(page)));
    schedule();
  });
  R.on("character", schedule);
  R.on("member", schedule);
})();
