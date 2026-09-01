/**
 * QuoteFlow embed SDK.
 *
 * Usage:
 *   <div data-quoteflow-flow="fl_event_rental"></div>
 *   <script src="https://your-site.com/quoteflow.js" async></script>
 *
 * Or programmatically:
 *   QuoteFlow.render({ el: '#quote', flow: 'fl_event_rental', onSubmit: (d) => {} });
 */
(function () {
  var ORIGIN = document.currentScript
    ? new URL(document.currentScript.src).origin
    : window.location.origin;

  var handlers = {};

  function render(opts) {
    var el = typeof opts.el === "string" ? document.querySelector(opts.el) : opts.el;
    if (!el || !opts.flow) return null;

    var iframe = document.createElement("iframe");
    iframe.src = (opts.origin || ORIGIN) + "/embed/" + encodeURIComponent(opts.flow);
    iframe.title = "Request a quote";
    iframe.loading = "lazy";
    iframe.style.width = "100%";
    iframe.style.border = "0";
    iframe.style.height = (opts.height || 720) + "px";
    iframe.setAttribute("allowtransparency", "true");
    el.appendChild(iframe);

    if (opts.onSubmit) handlers[opts.flow] = opts.onSubmit;
    return iframe;
  }

  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.type === "quoteflow:resize") {
      var frames = document.querySelectorAll('iframe[src*="/embed/"]');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === event.source) frames[i].style.height = data.height + "px";
      }
    }
    if (data.type === "quoteflow:submit" && handlers[data.flowId]) {
      handlers[data.flowId](data.payload);
    }
  });

  function autoInit() {
    var nodes = document.querySelectorAll("[data-quoteflow-flow]");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-quoteflow-ready")) continue;
      nodes[i].setAttribute("data-quoteflow-ready", "1");
      render({ el: nodes[i], flow: nodes[i].getAttribute("data-quoteflow-flow") });
    }
  }

  window.QuoteFlow = { render: render, refresh: autoInit };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
})();
