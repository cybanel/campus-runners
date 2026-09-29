// shared.js
// Small helpers reused across pages so validation behaves identically
// everywhere. Include this file with <script src="shared.js"></script>
// BEFORE each page's own inline <script>.

function setFieldState(inputId, errorId, isValid) {
  var input = document.getElementById(inputId);
  var error = document.getElementById(errorId);
  if (isValid) {
    input.classList.remove("invalid");
    error.classList.remove("show");
  } else {
    input.classList.add("invalid");
    error.classList.add("show");
  }
}

function isValidAupEmail(email) {
  return /^[a-z0-9._%+-]+@aup\.edu\.ph$/.test(email);
}

// Clears the error state on a field as soon as the user starts fixing it.
// Pass the list of input ids present on the current page.
function attachLiveValidationClearing(ids) {
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", function () {
      this.classList.remove("invalid");
      document.getElementById(id + "-error").classList.remove("show");
    });
  });
}

// ---- In-app toast notifications ----
// Replaces window.alert() with a small notification that appears inside
// the phone frame instead of a native browser popup.
function showToast(message, opts) {
  opts = opts || {};
  var duration = opts.duration || 2600;
  var type = opts.type || "default";

  var host = document.querySelector(".phone-frame") || document.body;
  var container = host.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    host.appendChild(container);
  }

  var toast = document.createElement("div");
  toast.className = "toast" + (type === "error" ? " toast-error" : "");
  toast.textContent = message;
  container.appendChild(toast);

  // Force layout so the transition runs, then show it.
  requestAnimationFrame(function () {
    toast.classList.add("show");
  });

  setTimeout(function () {
    toast.classList.remove("show");
    setTimeout(function () {
      toast.remove();
    }, 250);
  }, duration);

  return toast;
}

// ---- Cross-page "session" ----
// The original single-file prototype kept the logged-in user's first name
// in a JS variable and swapped screens in place. Now that each screen is
// its own page, we use localStorage to carry that name from
// createaccount.html into home.html (and keep it for login.html too).
var CampusRunnersSession = {
  setFirstName: function (name) {
    localStorage.setItem("cr_first_name", name);
  },
  getFirstName: function () {
    return localStorage.getItem("cr_first_name");
  },
};

// ---- Order lifecycle (customer-side prototype) ----
// One order at a time is "active". Every page (Home, Activity, Track,
// Messages) reads the same record from localStorage, so they always agree.
// When an order finishes it moves to the "past" list.
//
// The same flow serves every errand type (cafeteria, Kubo, store):
// the customer sets a BUDGET and writes a MESSAGE, and the details are
// settled in chat. The runner pays first; the customer pays the receipt
// total plus the delivery fee in cash after delivery.
//
// Statuses, in order:
//   searching -> accepted -> choosing -> buying -> receipt -> on_the_way -> arrived
// and then it ends as "delivered" (both sides confirmed) or "cancelled".
var CampusRunnersOrder = (function () {
  var ACTIVE_KEY = "cr_active_order";
  var PAST_KEY = "cr_past_orders";

  // PLACEHOLDER: how long to search before asking "keep waiting or cancel?"
  var SEARCH_TIMEOUT_MS = 60 * 1000;

  // PLACEHOLDER runner used by the demo panel until real runners exist.
  var DEMO_RUNNER = { name: "Marco Dela Cruz" };

  var PLACES = {
    cafeteria: { label: "Cafeteria", phrase: "the cafeteria", emoji: "🍛" },
    kubo: { label: "Kubo", phrase: "Kubo", emoji: "🍜" },
    store: { label: "Store", phrase: "the store", emoji: "🏪" },
  };

  var FLOW = [
    "searching",
    "accepted",
    "choosing",
    "buying",
    "receipt",
    "on_the_way",
    "arrived",
  ];

  var LABELS = {
    searching: "Looking for a runner",
    accepted: "Runner accepted",
    choosing: "Confirming your order",
    buying: "Buying your order",
    receipt: "Receipt sent",
    on_the_way: "On the way to you",
    arrived: "Runner is here",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };

  // PLACEHOLDER sample photos the demo runner "sends".
  var SAMPLE_FINDS = {
    cafeteria: [
      { emoji: "🍗", name: "Chicken adobo", price: 50 },
      { emoji: "🍚", name: "Rice", price: 25 },
      { emoji: "🍫", name: "Brownie", price: 15 },
    ],
    kubo: [
      { emoji: "🍜", name: "Pancit canton", price: 25 },
      { emoji: "💧", name: "Bottled water", price: 20 },
      { emoji: "🍪", name: "Biscuits", price: 15 },
    ],
    store: [
      { emoji: "📓", name: "Notebook", price: 35 },
      { emoji: "🖊️", name: "Ballpen", price: 10 },
      { emoji: "📁", name: "Folder", price: 8 },
    ],
  };

  var subscribers = [];

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function emit() {
    subscribers.forEach(function (fn) {
      fn();
    });
  }

  function get() {
    return read(ACTIVE_KEY, null);
  }

  function getPast() {
    return read(PAST_KEY, []);
  }

  function save(order) {
    write(ACTIVE_KEY, order);
    emit();
  }

  function truncate(text, n) {
    text = (text || "").replace(/\s+/g, " ").trim();
    return text.length > n ? text.slice(0, n - 1) + "…" : text;
  }

  // Which errand type an order is (older saved orders default to cafeteria).
  function place(order) {
    return PLACES[order && order.type] || PLACES.cafeteria;
  }

  // The most the runner may spend on items: budget + any approved extra.
  function spendLimit(order) {
    return (order.budget || 0) + (order.extraApproved || 0);
  }

  // The most the customer could pay: item limit + delivery fee.
  function maxToPay(order) {
    return spendLimit(order) + (order.deliveryFee || 0);
  }

  // Creates the active order. Returns null if one is already in progress.
  function create(details) {
    if (get()) return null;
    var now = Date.now();
    var budget = details.budget || 0;
    var fee = details.deliveryFee || 0;
    var order = {
      id: "CR-" + now.toString(36).toUpperCase(),
      type: PLACES[details.type] ? details.type : "cafeteria",
      createdAt: now,
      searchStartedAt: now,
      status: "searching",
      dropoff: details.dropoff || "",
      budget: budget,
      deliveryFee: fee,
      total: budget + fee, // the most the customer could pay
      message: details.message || "",
      summary: truncate(details.message, 48) || "Budget ₱" + budget,
      runner: null,
      customerConfirmed: false,
      runnerConfirmed: false,
      // Chat + buying steps
      chat: [],
      photosSent: false,
      confirmAsked: false,
      itemsConfirmed: false,
      overBudget: null,
      extraApproved: 0,
      receiptTotal: null,
      payTotal: null,
    };
    save(order);
    return order;
  }

  // Moves the active order into the past list with a final status.
  function archive(order, status, extra) {
    order.status = status;
    order.completedAt = Date.now();
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        order[k] = extra[k];
      });
    }
    var past = getPast();
    past.unshift(order);
    write(PAST_KEY, past.slice(0, 30));
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch (e) {}
    emit();
  }

  function runnerFirstName(order) {
    return order && order.runner
      ? order.runner.name.split(" ")[0]
      : "Your runner";
  }

  function pushMessage(order, msg) {
    if (!order.chat) order.chat = [];
    msg.id = order.chat.length + 1;
    msg.at = Date.now();
    order.chat.push(msg);
  }

  function setStatus(key) {
    var order = get();
    if (!order) return;
    order.status = key;
    if (key === "accepted" && !order.runner) {
      order.runner = DEMO_RUNNER;
      order.acceptedAt = Date.now();
    }
    var name = runnerFirstName(order);
    var where = place(order).phrase;
    var dropoff = order.dropoff || "your drop-off point";

    if (key === "accepted") {
      pushMessage(order, {
        from: "system",
        type: "text",
        text: name + " accepted your order.",
      });
      pushMessage(order, {
        from: "runner",
        type: "text",
        text:
          "Hi! I'm heading to " +
          where +
          " now. I'll send you photos of what I find and check with you before I buy anything.",
      });
    } else if (key === "choosing") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: "I'm at " + where + " now. Sending photos of what's available.",
      });
    } else if (key === "buying") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: "Buying your order now. If anything costs more than your budget, I'll ask you first.",
      });
    } else if (key === "receipt") {
      pushMessage(order, {
        from: "runner",
        type: "receipt",
        receiptTotal: order.receiptTotal,
        fee: order.deliveryFee || 0,
        total: order.payTotal,
        text: "All done! Here's your receipt.",
      });
    } else if (key === "on_the_way") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: "Got it, I'm on my way to " + dropoff + "!",
      });
    } else if (key === "arrived") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: "I'm here at " + dropoff + ". I'll wait outside, come find me!",
      });
    }
    save(order);
  }

  // ---- Chat + buying steps ----

  function sendCustomerMessage(text) {
    var order = get();
    text = (text || "").trim();
    if (!order || !order.runner || !text) return false;
    pushMessage(order, { from: "you", type: "text", text: text.slice(0, 500) });
    save(order);
    return true;
  }

  // Runner sends photos of what's available (demo panel triggers this).
  // The customer then says what they want in the chat.
  function sendPhotos() {
    var order = get();
    if (!order || order.status !== "choosing" || order.photosSent) return;
    pushMessage(order, {
      from: "runner",
      type: "photos",
      options:
        SAMPLE_FINDS[place(order).label.toLowerCase()] ||
        SAMPLE_FINDS.cafeteria,
      text: "Here's what's available today. Tell me what you'd like and I'll check with you before I buy.",
    });
    order.photosSent = true;
    save(order);
  }

  // After chatting about what to buy, the runner asks the customer to
  // confirm (demo panel triggers this). PLACEHOLDER wording: the demo quotes
  // the customer's latest message, or the original request if they haven't
  // written one.
  function askConfirmation() {
    var order = get();
    if (
      !order ||
      order.status !== "choosing" ||
      !order.photosSent ||
      order.confirmAsked
    )
      return;
    var summary = order.message;
    for (var i = order.chat.length - 1; i >= 0; i--) {
      if (order.chat[i].from === "you" && order.chat[i].type === "text") {
        summary = order.chat[i].text;
        break;
      }
    }
    pushMessage(order, {
      from: "runner",
      type: "confirm",
      summary: summary,
      result: null,
      text: "Just to confirm, is this what you'd like me to buy? If it is, tap Looks good.",
    });
    order.confirmAsked = true;
    save(order);
  }

  // The "Looks good" button: a record that the customer agreed to the
  // order. The actual agreeing happens in the chat.
  function confirmItems() {
    var order = get();
    if (!order || !order.confirmAsked || order.itemsConfirmed) return false;
    order.itemsConfirmed = true;
    for (var i = order.chat.length - 1; i >= 0; i--) {
      if (order.chat[i].type === "confirm" && !order.chat[i].result) {
        order.chat[i].result = "confirmed";
        order.chat[i].confirmedAt = Date.now();
        break;
      }
    }
    pushMessage(order, {
      from: "system",
      type: "text",
      text:
        "You confirmed the order. " +
        runnerFirstName(order) +
        " can start buying.",
    });
    save(order);
    return true;
  }

  // Runner asks to spend more than the budget (demo panel triggers this).
  // PLACEHOLDER: the demo always asks for ₱20 more.
  function requestOverBudget(extra) {
    var order = get();
    if (!order || order.status !== "buying") return;
    if (order.overBudget && order.overBudget.status === "pending") return;
    extra = extra || 20;
    order.overBudget = { extra: extra, status: "pending" };
    pushMessage(order, {
      from: "runner",
      type: "overbudget",
      extra: extra,
      newLimit: spendLimit(order) + extra,
      result: null,
      text:
        "One of your items costs more than your budget. Can I spend ₱" +
        extra +
        " more?",
    });
    save(order);
  }

  // Customer approves or declines the extra spending.
  function respondOverBudget(approved) {
    var order = get();
    if (!order || !order.overBudget || order.overBudget.status !== "pending")
      return false;
    var extra = order.overBudget.extra;
    order.overBudget.status = approved ? "approved" : "declined";

    // Mark the request card in the chat with the answer.
    for (var i = order.chat.length - 1; i >= 0; i--) {
      if (order.chat[i].type === "overbudget" && !order.chat[i].result) {
        order.chat[i].result = approved ? "approved" : "declined";
        break;
      }
    }

    if (approved) {
      order.extraApproved = (order.extraApproved || 0) + extra;
      pushMessage(order, {
        from: "you",
        type: "text",
        text: "Yes, you can spend ₱" + extra + " more.",
      });
      pushMessage(order, {
        from: "system",
        type: "text",
        text:
          "You approved ₱" +
          extra +
          " over budget. Spending limit: ₱" +
          spendLimit(order) +
          ".",
      });
    } else {
      pushMessage(order, {
        from: "you",
        type: "text",
        text: "No, please stay within my budget.",
      });
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: "No problem, I'll stay within your budget.",
      });
    }
    save(order);
    return true;
  }

  // PLACEHOLDER receipt amount for the demo: 90% of the budget (rounded to
  // ₱5), or the full approved limit if the customer approved extra spending.
  // It never exceeds the spending limit.
  function demoReceiptTotal(order) {
    var limit = spendLimit(order);
    if (order.extraApproved > 0) return limit;
    var amount = Math.round((order.budget * 0.9) / 5) * 5;
    return Math.max(1, Math.min(limit, amount || order.budget));
  }

  // Demo helper: move to the next step in the flow.
  function advance() {
    var order = get();
    if (!order) return;

    // The runner can't start buying until the customer taps "Looks good".
    if (order.status === "choosing" && !order.itemsConfirmed) return;

    if (order.status === "buying") {
      // Can't finish buying while an over-budget request is unanswered.
      if (order.overBudget && order.overBudget.status === "pending") return;
      order.receiptTotal = demoReceiptTotal(order);
      order.payTotal = order.receiptTotal + (order.deliveryFee || 0);
      save(order);
    }

    var i = FLOW.indexOf(order.status);
    if (i >= 0 && i < FLOW.length - 1) setStatus(FLOW[i + 1]);
  }

  // Cancelling rules:
  //  - while searching: free, no reason needed
  //  - runner accepted / confirming the order: needs a reason
  //  - once the runner is buying: not allowed
  function cancel(reason) {
    var order = get();
    if (!order) return { ok: false, message: "There is no order to cancel." };

    if (order.status === "searching") {
      archive(order, "cancelled", {
        cancelReason: reason || "Cancelled before a runner accepted",
      });
      return { ok: true };
    }
    if (order.status === "accepted" || order.status === "choosing") {
      if (!reason) {
        return {
          ok: false,
          needsReason: true,
          message: "Please tell us why you're cancelling.",
        };
      }
      archive(order, "cancelled", { cancelReason: reason });
      return { ok: true };
    }
    return {
      ok: false,
      message:
        "Your runner is already buying your order, so it can't be cancelled here. Message your runner if something is wrong.",
    };
  }

  // The order only finishes when BOTH sides confirm (customer: received,
  // runner: cash received). Only valid once the runner has arrived.
  function confirm(side) {
    var order = get();
    if (!order || order.status !== "arrived") return false;
    if (side === "customer") order.customerConfirmed = true;
    if (side === "runner") order.runnerConfirmed = true;
    if (order.customerConfirmed && order.runnerConfirmed) {
      archive(order, "delivered", { paidTotal: order.payTotal });
    } else {
      save(order);
    }
    return true;
  }

  function isSearchTimedOut(order) {
    if (!order || order.status !== "searching") return false;
    var start = order.searchStartedAt || order.createdAt;
    return Date.now() - start >= SEARCH_TIMEOUT_MS;
  }

  function keepSearching() {
    var order = get();
    if (!order || order.status !== "searching") return;
    order.searchStartedAt = Date.now();
    save(order);
  }

  // Customer-facing wording for the current step (Home card, Track, etc.)
  function cardText(order) {
    var name = runnerFirstName(order);
    var dropoff = order.dropoff || "your drop-off point";
    var p = place(order);
    switch (order.status) {
      case "searching":
        if (isSearchTimedOut(order)) {
          return {
            title: "Still looking for a runner",
            sub: "It's taking longer than usual.",
          };
        }
        return {
          title: "Finding you a runner…",
          sub: p.label + " → " + dropoff,
        };
      case "accepted":
        return {
          title: name + " accepted your order",
          sub: "Heading to " + p.phrase,
        };
      case "choosing":
        return {
          title: name + " is at " + p.phrase,
          sub: "Open Messages to confirm what to buy",
        };
      case "buying":
        if (order.overBudget && order.overBudget.status === "pending") {
          return {
            title: name + " needs your OK",
            sub: "An item costs more than your budget",
          };
        }
        return { title: name + " is buying your order", sub: "Hang tight" };
      case "receipt":
        return {
          title: name + " sent your receipt",
          sub: "Amount to pay: ₱" + (order.payTotal || 0),
        };
      case "on_the_way":
        return { title: name + " is on the way", sub: "Heading to " + dropoff };
      case "arrived":
        return {
          title: name + " is here",
          sub: "Meet them outside at " + dropoff,
        };
      case "delivered":
        return {
          title: "Order delivered",
          sub: "Thanks for using CampusRunners",
        };
      default:
        return { title: "Order cancelled", sub: "" };
    }
  }

  function reset() {
    try {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(PAST_KEY);
    } catch (e) {}
    emit();
  }

  function subscribe(fn) {
    subscribers.push(fn);
  }

  // Keep other open tabs/pages in sync.
  window.addEventListener("storage", function (e) {
    if (e.key === ACTIVE_KEY || e.key === PAST_KEY) emit();
  });

  return {
    STATUS_LABELS: LABELS,
    FLOW: FLOW,
    PLACES: PLACES,
    place: place,
    spendLimit: spendLimit,
    maxToPay: maxToPay,
    get: get,
    getPast: getPast,
    create: create,
    setStatus: setStatus,
    advance: advance,
    sendCustomerMessage: sendCustomerMessage,
    sendPhotos: sendPhotos,
    askConfirmation: askConfirmation,
    confirmItems: confirmItems,
    requestOverBudget: requestOverBudget,
    respondOverBudget: respondOverBudget,
    cancel: cancel,
    confirm: confirm,
    isSearchTimedOut: isSearchTimedOut,
    keepSearching: keepSearching,
    cardText: cardText,
    runnerFirstName: runnerFirstName,
    reset: reset,
    subscribe: subscribe,
  };
})();

// ---- Demo runner panel ----
// Design-time stand-in for the runner's app. Adds a small "Demo" button in
// the phone frame; tapping it shows the buttons a real runner would press.
// Call CampusRunnersDemo.mount() on any page that should have it. Remove
// the call (or this block) when real runner screens exist.
var CampusRunnersDemo = (function () {
  function mount() {
    var host = document.querySelector(".phone-frame");
    if (!host || host.querySelector(".demo-toggle")) return;

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "demo-toggle";
    toggle.textContent = "🛠 Demo";

    var panel = document.createElement("div");
    panel.className = "demo-panel";
    panel.hidden = true;

    toggle.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
    });

    host.appendChild(toggle);
    host.appendChild(panel);

    function addButton(label, handler, ghost) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "demo-btn" + (ghost ? " demo-btn-ghost" : "");
      b.textContent = label;
      b.addEventListener("click", function () {
        handler();
      });
      panel.appendChild(b);
    }

    function addNote(text) {
      var n = document.createElement("div");
      n.className = "demo-note";
      n.textContent = text;
      panel.appendChild(n);
    }

    function render() {
      panel.innerHTML = "";
      var Orders = CampusRunnersOrder;

      var title = document.createElement("div");
      title.className = "demo-title";
      title.textContent = "Demo runner";
      panel.appendChild(title);

      var order = Orders.get();
      var status = order ? order.status : null;

      addNote(
        order ? "Now: " + Orders.STATUS_LABELS[status] : "No active order.",
      );

      if (!order) {
        addButton("Create a sample order", function () {
          Orders.create({
            type: "cafeteria",
            dropoff: "Library",
            budget: 100,
            deliveryFee: 30,
            message: "2 viands and 1 rice please",
          });
        });
      } else if (status === "searching") {
        addButton("Runner accepts", Orders.advance);
      } else if (status === "accepted") {
        addButton(
          "Runner reached " + Orders.place(order).label,
          Orders.advance,
        );
      } else if (status === "choosing") {
        if (!order.photosSent) {
          addButton("Runner sends photos", Orders.sendPhotos);
        } else if (!order.confirmAsked) {
          addNote("Chat about what you want, then:");
          addButton("Runner asks to confirm", Orders.askConfirmation);
        } else if (!order.itemsConfirmed) {
          addNote("Waiting for you to tap “Looks good” in Messages.");
        } else {
          addButton("Runner starts buying", Orders.advance);
        }
      } else if (status === "buying") {
        if (order.overBudget && order.overBudget.status === "pending") {
          addNote(
            "Waiting for you to answer the over-budget request in Messages.",
          );
        } else {
          addButton("Runner: item costs more", function () {
            Orders.requestOverBudget(20);
          });
          addButton("Runner sends receipt", Orders.advance);
        }
      } else if (status === "receipt") {
        addButton("Runner heads to drop-off", Orders.advance);
      } else if (status === "on_the_way") {
        addButton("Runner: I'm here", Orders.advance);
      } else if (status === "arrived") {
        addButton("Runner: cash received", function () {
          Orders.confirm("runner");
        });
        addButton("Customer: I received it", function () {
          Orders.confirm("customer");
        });
      }

      addButton("Reset demo", Orders.reset, true);
    }

    CampusRunnersOrder.subscribe(render);
    render();
  }

  return { mount: mount };
})();
