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
    // Gazebo Parcel Pick Up is NOT a shopping errand: the runner only
    // collects parcels that are already waiting at the gazebo.
    gazebo: { label: "Gazebo", phrase: "the Gazebo", emoji: "📦" },
    gate: { label: "At the Gate", phrase: "AUP Main Gate", emoji: "🚪" },
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

  // Gazebo orders have no budget, no "Looks good" step and no receipt, so
  // they use a shorter flow. Pickup photos are proof only: the customer
  // does not have to approve them.
  var FLOW_GAZEBO = [
    "searching",
    "accepted",
    "picking_up",
    "on_the_way",
    "arrived",
  ];

  // Gate food orders have one customer, one food order, and two proof stages.
  var FLOW_GATE = [
    "searching",
    "accepted",
    "waiting_food",
    "gate_pickup",
    "on_the_way",
    "arrived",
  ];

  // ------------------------------------------------------------------
  // Gazebo Parcel Pick Up: PLACEHOLDER numbers and lists.
  // *** Everything you may want to change lives in this one block. ***
  // ------------------------------------------------------------------
  var GAZEBO = {
    maxParcels: 5, // PLACEHOLDER cap on parcels per request
    warnMinutes: 15, // soft warning if the rider leaves within this many minutes
    // One size for the whole pile of parcels. The fee is NOT per parcel.
    sizes: {
      small: { label: "Small", fee: 30 },
      medium: { label: "Medium", fee: 35 },
      large: { label: "Large", fee: 40 },
    },
    couriers: ["SPX", "Lazada Express", "J&T", "Flash", "TikTok Shop", "Other"],
    handovers: {
      meet: "Meet me outside",
      front_desk: "Leave at the front desk",
    },
    payments: { cash: "Cash", online: "GCash / Online" },
    // Front desk is only offered for these drop-offs.
    frontDeskDropoffs: [
      "Cattleya Dormitory",
      "Cadena de Amor Dormitory",
      "Waling-Waling Dormitory",
      "Sampaguita Dormitory",
    ],
    // The 18 campus drop-off points minus the Gazebo (it is the pickup).
    dropoffs: [
      "Dentistry Department",
      "SA Park",
      "College of Business",
      "College of Science and Technology",
      "Pioneer",
      "College of Medicine",
      "Library",
      "College of Nursing",
      "College of Theology",
      "College of Education",
      "College of Arts and Humanities",
      "AUP Gym",
      "AUP Main Gate",
      "Cattleya Dormitory",
      "Cadena de Amor Dormitory",
      "Waling-Waling Dormitory",
      "Sampaguita Dormitory",
    ],
  };

  // At the Gate Pick Up is for one food delivery to one customer.
  // Fee groups mirror the existing errand placeholder rates.
  var GATE = {
    pickup: "AUP Main Gate",
    services: ["Foodpanda", "Grab", "Other"],
    arrivals: {
      now: "Already at the gate",
      minutes30: "In about 30 minutes",
      hour1: "In about 1 hour",
    },
    handovers: GAZEBO.handovers,
    payments: GAZEBO.payments,
    frontDeskDropoffs: GAZEBO.frontDeskDropoffs,
    fees: {
      base: 30,
      zoneExtra: { near: 0, mid: 5, far: 10 },
      peakExtra: 10,
      peakHours: [{ from: 11, to: 13 }],
    },
    zones: {
      Library: "near",
      Pioneer: "near",
      "SA Park": "near",
      Gazebo: "near",
      "College of Business": "near",
      "College of Science and Technology": "near",
      "College of Education": "mid",
      "College of Arts and Humanities": "mid",
      "College of Nursing": "mid",
      "College of Theology": "mid",
      "AUP Gym": "mid",
      "College of Medicine": "mid",
      "Dentistry Department": "mid",
      "Cattleya Dormitory": "far",
      "Cadena de Amor Dormitory": "far",
      "Waling-Waling Dormitory": "far",
      "Sampaguita Dormitory": "far",
    },
    dropoffs: [
      "Dentistry Department",
      "SA Park",
      "College of Business",
      "College of Science and Technology",
      "Pioneer",
      "College of Medicine",
      "Library",
      "College of Nursing",
      "College of Theology",
      "College of Education",
      "College of Arts and Humanities",
      "AUP Gym",
      "Gazebo",
      "Cattleya Dormitory",
      "Cadena de Amor Dormitory",
      "Waling-Waling Dormitory",
      "Sampaguita Dormitory",
    ],
  };

  var LABELS = {
    searching: "Looking for a runner",
    accepted: "Runner accepted",
    waiting_food: "Waiting for food at the gate",
    gate_pickup: "Picking up your food",
    picking_up: "Picking up your parcels",
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

  // ---- Gazebo helpers ----
  function isGazebo(order) {
    return !!order && order.type === "gazebo";
  }

  function isGate(order) {
    return !!order && order.type === "gate";
  }

  function isFrontDesk(order) {
    return (isGazebo(order) || isGate(order)) && order.handover === "front_desk";
  }

  function flowFor(order) {
    if (isGate(order)) {
      return order.expectedArrival === "now"
        ? ["searching", "accepted", "gate_pickup", "on_the_way", "arrived"]
        : FLOW_GATE;
    }
    return isGazebo(order) ? FLOW_GAZEBO : FLOW;
  }

  function parcelWord(n) {
    return n + (n === 1 ? " parcel" : " parcels");
  }

  // "14:00" -> "2:00 PM". Returns "" for anything that isn't HH:MM.
  function formatClock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return "";
    var h = parseInt(m[1], 10);
    if (h > 23) return "";
    return (h % 12 || 12) + ":" + m[2] + " " + (h >= 12 ? "PM" : "AM");
  }

  // Matches text to an official Gazebo drop-off (case-insensitive) or "".
  function matchGazeboDropoff(text) {
    var wanted = (text || "").trim().toLowerCase();
    for (var i = 0; i < GAZEBO.dropoffs.length; i++) {
      if (GAZEBO.dropoffs[i].toLowerCase() === wanted)
        return GAZEBO.dropoffs[i];
    }
    return "";
  }

  function matchGateDropoff(text) {
    var wanted = (text || "").trim().toLowerCase();
    for (var i = 0; i < GATE.dropoffs.length; i++) {
      if (GATE.dropoffs[i].toLowerCase() === wanted) return GATE.dropoffs[i];
    }
    return "";
  }

  function gateDeliveryFee(dropoff, at) {
    var place = matchGateDropoff(dropoff);
    if (!place) return 0;
    var fees = GATE.fees;
    var amount = fees.base + fees.zoneExtra[GATE.zones[place]];
    var date = at == null ? new Date() : new Date(at);
    if (fees.peakHours.some(function (window) {
      return date.getHours() >= window.from && date.getHours() < window.to;
    })) amount += fees.peakExtra;
    return amount;
  }

  // The most the customer could pay. For Gazebo orders the total is exact
  // (COD amounts + one delivery fee), so it is also the amount to pay.
  function maxToPay(order) {
    if (isGazebo(order) || isGate(order)) return order.total || 0;
    return spendLimit(order) + (order.deliveryFee || 0);
  }

  // Wording for the money line on Activity: "Paid ₱X", "Total ₱X" (exact)
  // or "Up to ₱X" (budget orders).
  function amountLabel(order) {
    if (order.status === "delivered" && order.paidTotal != null) {
      return { prefix: "Paid ", amount: order.paidTotal };
    }
    if (isGazebo(order) || isGate(order))
      return { prefix: "Total ", amount: order.total || 0 };
    return { prefix: "Up to ", amount: order.total || 0 };
  }

  // Creates the active order. Returns null if one is already in progress.
  function create(details) {
    if (get()) return null;
    if (details && details.type === "gazebo") return createGazebo(details);
    if (details && details.type === "gate") return createGate(details);
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
      inQueue: false,
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

  // Creates a Gazebo Parcel Pick Up order. Everything is re-checked here (not
  // just in the form), and the fee and totals are recalculated from the
  // config. Returns null if the details are invalid.
  function createGazebo(details) {
    var size = GAZEBO.sizes[details.parcelSize] ? details.parcelSize : "";
    var dropoff = matchGazeboDropoff(details.dropoff);
    var riderUntil =
      /^\d{1,2}:\d{2}$/.test(details.riderUntil || "") &&
      formatClock(details.riderUntil)
        ? details.riderUntil
        : "";

    var input = details.parcels || [];
    if (!size || !dropoff || !riderUntil) return null;
    if (!input.length || input.length > GAZEBO.maxParcels) return null;

    var parcels = [];
    var codTotal = 0;
    for (var i = 0; i < input.length; i++) {
      var p = input[i] || {};
      var name = String(p.name || "")
        .trim()
        .slice(0, 60);
      var courier = String(p.courier || "")
        .trim()
        .slice(0, 30);
      var isCod = !!p.isCod;
      var amount = isCod ? Math.floor(Number(p.codAmount)) : 0;
      if (!name || !courier) return null;
      if (isCod && !(amount >= 1)) return null;
      parcels.push({
        name: name,
        courier: courier,
        isCod: isCod,
        codAmount: amount,
      });
      codTotal += amount;
    }

    // Front desk only for dorms, and front desk always means pay online.
    var canFrontDesk = GAZEBO.frontDeskDropoffs.indexOf(dropoff) !== -1;
    var handover =
      details.handover === "front_desk" && canFrontDesk ? "front_desk" : "meet";
    var paymentMethod =
      handover === "front_desk" || details.paymentMethod === "online"
        ? "online"
        : "cash";

    var now = Date.now();
    var fee = GAZEBO.sizes[size].fee;
    var total = codTotal + fee;
    var order = {
      id: "CR-" + now.toString(36).toUpperCase(),
      type: "gazebo",
      createdAt: now,
      searchStartedAt: now,
      status: "searching",
      dropoff: dropoff,
      budget: 0,
      deliveryFee: fee,
      total: total, // exact: COD amounts + delivery fee
      message: String(details.message || "")
        .trim()
        .slice(0, 300),
      summary:
        parcelWord(parcels.length) +
        (codTotal ? " · COD ₱" + codTotal : " · Already paid"),
      runner: null,
      customerConfirmed: false,
      runnerConfirmed: false,
      chat: [],
      inQueue: false,
      photosSent: false,
      confirmAsked: false,
      itemsConfirmed: false,
      overBudget: null,
      extraApproved: 0,
      receiptTotal: null,
      payTotal: total,
      // Gazebo-only fields
      parcels: parcels,
      parcelSize: size,
      riderUntil: riderUntil,
      handover: handover,
      paymentMethod: paymentMethod,
      codTotal: codTotal,
      pickupPhotos: false,
      deliveryPhoto: false,
    };
    save(order);
    return order;
  }

  // Creates one food-delivery pickup at the AUP Main Gate for one customer.
  function createGate(details) {
    var dropoff = matchGateDropoff(details.dropoff);
    var name = String(details.foodName || "").trim().slice(0, 60);
    var service = String(details.foodService || "").trim().slice(0, 50);
    var expectedArrival = GATE.arrivals[details.expectedArrival]
      ? details.expectedArrival
      : "";
    var paymentStatus = details.foodPaymentStatus;
    var codAmount = paymentStatus === "cod"
      ? Math.floor(Number(details.codAmount))
      : 0;

    if (
      !dropoff ||
      dropoff === GATE.pickup ||
      !name ||
      !GATE.services.includes(service) ||
      ["paid", "cod"].indexOf(paymentStatus) === -1 ||
      (service === "Other" && !String(details.otherService || "").trim()) ||
      !expectedArrival ||
      (paymentStatus === "cod" && !(codAmount >= 1))
    ) return null;

    var deliveryService = service === "Other"
      ? String(details.otherService || "").trim().slice(0, 50)
      : service;
    var handover = details.handover === "front_desk" &&
      GATE.frontDeskDropoffs.indexOf(dropoff) !== -1
      ? "front_desk"
      : "meet";
    var paymentMethod =
      handover === "front_desk" || details.paymentMethod === "online"
        ? "online"
        : "cash";
    var message = String(details.message || "").trim().slice(0, 300);
    var fee = gateDeliveryFee(dropoff, details.feeAt);
    var total = codAmount + fee;
    var now = Date.now();
    var order = {
      id: "CR-" + now.toString(36).toUpperCase(),
      type: "gate",
      createdAt: now,
      searchStartedAt: now,
      status: "searching",
      pickup: GATE.pickup,
      dropoff: dropoff,
      budget: 0,
      deliveryFee: fee,
      total: total,
      payTotal: total,
      foodName: name,
      foodService: deliveryService,
      foodPaymentStatus: paymentStatus,
      codAmount: codAmount,
      codTotal: codAmount,
      expectedArrival: expectedArrival,
      handover: handover,
      paymentMethod: paymentMethod,
      message: message,
      summary:
        deliveryService + " food order for " + name +
        (paymentStatus === "cod" ? " · COD ₱" + codAmount : " · Already paid"),
      runner: null,
      customerConfirmed: false,
      runnerConfirmed: false,
      chat: [],
      inQueue: false,
      pickupPhotos: false,
      deliveryPhoto: false,
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

  function findPast(id) {
    return getPast().find(function (order) { return order && order.id === id; }) || null;
  }

  function pendingRating() {
    return getPast().find(function (order) {
      return order && order.status === "delivered" && !order.rating && !order.ratingSkippedAt;
    }) || null;
  }

  function rate(id, stars) {
    stars = Number(stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return false;
    var past = getPast();
    var order = past.find(function (item) { return item && item.id === id; });
    if (!order || order.status !== "delivered" || order.rating) return false;
    order.rating = { stars: stars, submittedAt: Date.now() };
    write(PAST_KEY, past);
    emit();
    return true;
  }

  function skipRating(id) {
    var past = getPast();
    var order = past.find(function (item) { return item && item.id === id; });
    if (!order || order.status !== "delivered" || order.rating) return false;
    order.ratingSkippedAt = Date.now();
    write(PAST_KEY, past);
    emit();
    return true;
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

  function payLine(order) {
    var parts = order.codTotal
      ? " (COD ₱" +
        order.codTotal +
        " + delivery fee ₱" +
        (order.deliveryFee || 0) +
        ")"
      : " (delivery fee)";
    return "Amount to pay: ₱" + (order.payTotal || 0) + parts + ".";
  }

  // Automatic runner messages for Gazebo orders (demo panel triggers them).
  function gazeboStatusMessages(order, key, name, dropoff) {
    var n = (order.parcels || []).length;
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
          "Hi! I'm heading to the Gazebo now to pick up your " +
          (n === 1 ? "parcel" : "parcels") +
          ". I'll send you photos as proof once I have them.",
      });
    } else if (key === "picking_up") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text:
          "I'm at the Gazebo now. Looking for your " +
          (n === 1 ? "parcel" : "parcels") +
          ".",
      });
    } else if (key === "on_the_way") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text:
          "Got it, I'm on my way to " +
          dropoff +
          "!" +
          (isFrontDesk(order)
            ? " I'll leave your parcels at the front desk."
            : ""),
      });
    } else if (key === "arrived") {
      var frontDesk = isFrontDesk(order);
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: frontDesk
          ? "I'm at " +
            dropoff +
            ". I'm leaving your parcels at the front desk now."
          : "I'm here at " + dropoff + ". I'll wait outside, come find me!",
      });
      // Delivery proof: separate from the pickup photos at the Gazebo.
      pushMessage(order, {
        from: "runner",
        type: "proof",
        kind: "delivery",
        photos: [
          {
            emoji: frontDesk ? "🚪" : "🤝",
            courier: frontDesk
              ? "Left at the front desk"
              : "Handed over outside",
            name: dropoff,
            cod: 0,
          },
        ],
        text: frontDesk
          ? "Here's a photo of your parcels at the front desk."
          : "Here's a photo of your parcels.",
      });
      order.deliveryPhoto = true;
      pushMessage(order, {
        from: "runner",
        type: "text",
        text:
          payLine(order) +
          (order.paymentMethod === "online"
            ? " Please pay through GCash / Online. I'll send my details here. I'll close the order once I've received your payment."
            : " Please prepare exact cash if you can."),
      });
    }
  }

  function gateStatusMessages(order, key, name, dropoff) {
    var foodName = order.foodName || "your food order";
    if (key === "accepted") {
      pushMessage(order, {
        from: "system",
        type: "text",
        text: name + " accepted your At the Gate Pick Up request.",
      });
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: "Hi! I'll pick up " + foodName + " at the AUP Main Gate. " +
          (order.expectedArrival === "now"
            ? "The food is already at the gate."
            : "Expected arrival: " + GATE.arrivals[order.expectedArrival] + "."),
      });
      if (order.foodPaymentStatus === "cod") {
        pushMessage(order, {
          from: "runner",
          type: "text",
          text: "I'll pay ₱" + order.codAmount + " COD to the food delivery rider.",
        });
      }
    } else if (key === "waiting_food") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text:
          "I'm preparing to meet the food delivery at the AUP Main Gate. " +
          "Expected arrival: " + GATE.arrivals[order.expectedArrival] + ".",
      });
    } else if (key === "gate_pickup") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: "Your food has arrived at the AUP Main Gate. I'm picking it up now.",
      });
    } else if (key === "on_the_way") {
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: "I picked up your food and am on my way to " + dropoff + ".",
      });
    } else if (key === "arrived") {
      var frontDesk = isFrontDesk(order);
      pushMessage(order, {
        from: "runner",
        type: "text",
        text: frontDesk
          ? "I left your food at the " + dropoff + " front desk."
          : "I'm at " + dropoff + ". I'll meet you outside.",
      });
      pushMessage(order, {
        from: "runner",
        type: "proof",
        kind: "delivery",
        photos: [{
          emoji: frontDesk ? "🚪" : "🍱",
          courier: frontDesk ? "Left at the front desk" : "Food handed over",
          name: dropoff,
          cod: 0,
        }],
        text: frontDesk
          ? "Here's proof that your food was left at the front desk."
          : "Here's proof that your food was delivered.",
      });
      order.deliveryPhoto = true;
      pushMessage(order, {
        from: "runner",
        type: "text",
        text:
          "Amount to pay me: ₱" + order.total + " (" +
          (order.foodPaymentStatus === "cod"
            ? "food COD ₱" + order.codAmount + " + "
            : "food order already paid + ") +
          "delivery fee ₱" + order.deliveryFee + "). " +
          (order.paymentMethod === "online"
            ? "Please pay through GCash / Online. I'll confirm once received."
            : "Please pay in cash when I hand over the food."),
      });
    }
  }

  function setStatus(key) {
    var order = get();
    if (!order) return;
    order.status = key;
    order.inQueue = false; // a new step starts, so the queue notice resets
    if (key === "accepted" && !order.runner) {
      order.runner = DEMO_RUNNER;
      order.acceptedAt = Date.now();
    }
    var name = runnerFirstName(order);
    var where = place(order).phrase;
    var dropoff = order.dropoff || "your drop-off point";

    if (isGate(order)) {
      gateStatusMessages(order, key, name, dropoff);
      save(order);
      return;
    }

    if (isGazebo(order)) {
      gazeboStatusMessages(order, key, name, dropoff);
      save(order);
      return;
    }

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

  // Runner tells the customer they're waiting in a long queue (demo panel
  // triggers this). Only while at the pickup point, and once per step so it
  // doesn't turn into spam.
  function notifyQueue() {
    var order = get();
    if (!order || order.inQueue) return;
    if (order.status !== "choosing" && order.status !== "buying") return;
    order.inQueue = true;
    pushMessage(order, {
      from: "runner",
      type: "queue",
      text:
        "🕒 I'm in the queue at " +
        place(order).phrase +
        ". It's a bit long, but I'm still here and I'll update you.",
    });
    save(order);
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

  // Runner sends one pickup photo per parcel (demo panel triggers this).
  // Proof only: the customer does not have to approve it.
  function sendPickupPhotos() {
    var order = get();
    if (!isGazebo(order) || order.status !== "picking_up" || order.pickupPhotos)
      return;
    var parcels = order.parcels || [];
    var codCount = parcels.filter(function (p) {
      return p.isCod;
    }).length;
    var text =
      "I found your " +
      (parcels.length === 1 ? "parcel" : "parcels") +
      " at the Gazebo. Here " +
      (parcels.length === 1
        ? "is the pickup photo."
        : "are the pickup photos.");
    if (order.codTotal > 0) {
      text +=
        " I paid ₱" +
        order.codTotal +
        " to the courier for the COD " +
        (codCount === 1 ? "parcel" : "parcels") +
        ".";
    }
    pushMessage(order, {
      from: "runner",
      type: "proof",
      kind: "pickup",
      photos: parcels.map(function (p) {
        return {
          emoji: "📦",
          courier: p.courier,
          name: p.name,
          cod: p.isCod ? p.codAmount : 0,
        };
      }),
      text: text,
    });
    order.pickupPhotos = true;
    save(order);
  }

  // The gate pickup photo is proof only; the customer never approves it.
  function sendGatePickupPhoto() {
    var order = get();
    if (!isGate(order) || order.status !== "gate_pickup" || order.pickupPhotos)
      return false;
    pushMessage(order, {
      from: "runner",
      type: "proof",
      kind: "pickup",
      label: "Pickup proof at the AUP Main Gate",
      photos: [{
        emoji: "🍱",
        courier: order.foodService,
        name: order.foodName,
        cod: order.foodPaymentStatus === "cod" ? order.codAmount : 0,
      }],
      text: order.foodPaymentStatus === "cod"
        ? "I picked up your food at the AUP Main Gate and paid ₱" +
          order.codAmount + " COD to the delivery rider."
        : "I picked up your food at the AUP Main Gate. The food order was already paid.",
    });
    order.pickupPhotos = true;
    save(order);
    return true;
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

    // Gazebo: the runner can't leave the Gazebo without sending pickup photos.
    if (isGazebo(order) && order.status === "picking_up" && !order.pickupPhotos)
      return;
    if (isGate(order) && order.status === "gate_pickup" && !order.pickupPhotos)
      return;

    // The runner can't start buying until the customer taps "Looks good".
    if (order.status === "choosing" && !order.itemsConfirmed) return;

    if (order.status === "buying") {
      // Can't finish buying while an over-budget request is unanswered.
      if (order.overBudget && order.overBudget.status === "pending") return;
      order.receiptTotal = demoReceiptTotal(order);
      order.payTotal = order.receiptTotal + (order.deliveryFee || 0);
      save(order);
    }

    var flow = flowFor(order);
    var i = flow.indexOf(order.status);
    if (i >= 0 && i < flow.length - 1) setStatus(flow[i + 1]);
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
    if (isGazebo(order) || isGate(order)) {
      return {
        ok: false,
        message:
          isGate(order)
            ? "Your runner is already preparing to collect your food, so it can't be cancelled here. Message your runner if something is wrong."
            : "Your runner is already picking up your parcels (and may have paid the courier), so it can't be cancelled here. Message your runner if something is wrong.",
      };
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
    if (side === "customer") {
      // "Leave at the front desk": nothing for the customer to tap.
      if (isFrontDesk(order)) return false;
      order.customerConfirmed = true;
    }
    if (side === "runner") order.runnerConfirmed = true;
    var customerDone = order.customerConfirmed || isFrontDesk(order);
    if (customerDone && order.runnerConfirmed) {
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

  // Gazebo wording for the steps that differ from the shopping flow.
  function gazeboCardText(order, name) {
    var dropoff = order.dropoff || "your drop-off point";
    var n = (order.parcels || []).length;
    if (order.status === "picking_up") {
      if (order.pickupPhotos) {
        return {
          title: name + " collected your " + (n === 1 ? "parcel" : "parcels"),
          sub: "Pickup photos are in Messages",
        };
      }
      return {
        title: name + " is at the Gazebo",
        sub: "Picking up your " + (n === 1 ? "parcel" : "parcels"),
      };
    }
    if (order.status === "arrived") {
      if (isFrontDesk(order)) {
        return {
          title: name + " left your parcels",
          sub: "At the front desk · pay ₱" + (order.payTotal || 0) + " online",
        };
      }
      return {
        title: name + " is here",
        sub: "Meet them outside at " + dropoff,
      };
    }
    return null;
  }

  function gateCardText(order, name) {
    var arrival = GATE.arrivals[order.expectedArrival] || "the scheduled time";
    var dropoff = order.dropoff || "your drop-off point";
    if (order.status === "waiting_food") {
      return {
        title: name + " is preparing for your food",
        sub: "Expected at the AUP Main Gate: " + arrival,
      };
    }
    if (order.status === "gate_pickup") {
      return order.pickupPhotos
        ? { title: name + " collected your food", sub: "Pickup proof is in Messages" }
        : { title: name + " is at the AUP Main Gate", sub: "Picking up your food" };
    }
    if (order.status === "arrived") {
      return isFrontDesk(order)
        ? {
            title: name + " left your food at the front desk",
            sub: "Pay ₱" + order.total + " through GCash / Online",
          }
        : { title: name + " is here", sub: "Meet outside at " + dropoff };
    }
    return null;
  }

  // Customer-facing wording for the current step (Home card, Track, etc.)
  function cardText(order) {
    if (isGate(order)) {
      var gateText = gateCardText(order, runnerFirstName(order));
      if (gateText) return gateText;
    }
    if (isGazebo(order)) {
      var g = gazeboCardText(order, runnerFirstName(order));
      if (g) return g;
    }
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
        if (order.inQueue) {
          return {
            title: name + " is in the queue",
            sub: "It's a bit long. " + name + " will update you.",
          };
        }
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
        if (order.inQueue) {
          return {
            title: name + " is in the queue",
            sub: "It's a bit long. Hang tight.",
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
    FLOW_GAZEBO: FLOW_GAZEBO,
    FLOW_GATE: FLOW_GATE,
    flowFor: flowFor,
    GAZEBO: GAZEBO,
    GATE: GATE,
    isGazebo: isGazebo,
    isGate: isGate,
    isFrontDesk: isFrontDesk,
    parcelWord: parcelWord,
    formatClock: formatClock,
    matchGazeboDropoff: matchGazeboDropoff,
    matchGateDropoff: matchGateDropoff,
    gateDeliveryFee: gateDeliveryFee,
    amountLabel: amountLabel,
    sendPickupPhotos: sendPickupPhotos,
    sendGatePickupPhoto: sendGatePickupPhoto,
    PLACES: PLACES,
    place: place,
    spendLimit: spendLimit,
    maxToPay: maxToPay,
    get: get,
    getPast: getPast,
    findPast: findPast,
    pendingRating: pendingRating,
    rate: rate,
    skipRating: skipRating,
    create: create,
    setStatus: setStatus,
    advance: advance,
    sendCustomerMessage: sendCustomerMessage,
    notifyQueue: notifyQueue,
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
      n.style.whiteSpace = "pre-line";
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
      panel.classList.toggle("demo-panel-gate", Orders.isGate(order));

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
        // PLACEHOLDER sample Gazebo orders (one per handover method).
        addButton("Create a sample Gazebo order", function () {
          Orders.create({
            type: "gazebo",
            dropoff: "Library",
            riderUntil: "14:00",
            parcels: [
              {
                name: "Juan Dela Cruz",
                courier: "SPX",
                isCod: false,
                codAmount: 0,
              },
              {
                name: "Juan Dela Cruz",
                courier: "Lazada Express",
                isCod: true,
                codAmount: 500,
              },
            ],
            parcelSize: "medium",
            message: "Please look for the parcels under Juan Dela Cruz.",
            handover: "meet",
            paymentMethod: "cash",
          });
        });
        addButton("Create a sample Gazebo order (front desk)", function () {
          Orders.create({
            type: "gazebo",
            dropoff: "Cattleya Dormitory",
            riderUntil: "14:00",
            parcels: [
              {
                name: "Juan Dela Cruz",
                courier: "SPX",
                isCod: true,
                codAmount: 350,
              },
              {
                name: "Juan Dela Cruz",
                courier: "TikTok Shop",
                isCod: true,
                codAmount: 250,
              },
            ],
            parcelSize: "medium",
            message: "",
            handover: "front_desk",
            paymentMethod: "online",
          });
        });
        addButton("Create a sample At the Gate food order", function () {
          Orders.create({
            type: "gate",
            dropoff: "Cattleya Dormitory",
            foodName: "Juan Dela Cruz",
            foodService: "Grab",
            foodPaymentStatus: "cod",
            codAmount: 350,
            expectedArrival: "minutes30",
            handover: "front_desk",
            paymentMethod: "online",
            message: "Please leave it at the Dormitory front desk.",
            feeAt: Date.now(),
          });
        });
      } else if (status === "searching") {
        addButton("Runner accepts", Orders.advance);
      } else if (Orders.isGate(order)) {
        addNote(
          "Runner task\nPick-up: " + Orders.GATE.pickup +
            "\nDrop-off: " + order.dropoff +
            "\nName on delivery: " + order.foodName +
            "\nService: " + order.foodService +
            "\nExpected: " + Orders.GATE.arrivals[order.expectedArrival] +
            "\nFood payment: " +
              (order.foodPaymentStatus === "cod"
                ? "COD ₱" + order.codAmount
                : "Already paid") +
            "\nHandover: " + Orders.GATE.handovers[order.handover] +
            "\nPayment to Runner: " + Orders.GATE.payments[order.paymentMethod] +
            "\nCustomer message: " + (order.message || "None"),
        );
        if (status === "accepted") {
          addButton(
            order.expectedArrival === "now"
              ? "Runner: food is at the AUP Main Gate"
              : "Runner prepares for the food arrival",
            Orders.advance,
          );
        } else if (status === "waiting_food") {
          addButton("Runner: food arrives at the AUP Main Gate", Orders.advance);
        } else if (status === "gate_pickup") {
          if (!order.pickupPhotos) {
            addButton("Runner sends pickup proof photo", Orders.sendGatePickupPhoto);
          } else {
            addButton("Runner heads to drop-off", Orders.advance);
          }
        } else if (status === "on_the_way") {
          addButton("Runner: arrives + delivery proof photo", Orders.advance);
        } else if (status === "arrived") {
          addButton(
            order.paymentMethod === "online"
              ? "Runner: payment received"
              : "Runner: cash received",
            function () { Orders.confirm("runner"); },
          );
          if (Orders.isFrontDesk(order)) {
            addNote("Front desk: order completes after payment is received.");
          } else {
            addButton("Customer: I received it", function () { Orders.confirm("customer"); });
          }
        }
      } else if (status === "accepted") {
        addButton(
          Orders.isGazebo(order)
            ? "Runner reached the Gazebo"
            : "Runner reached " + Orders.place(order).label,
          Orders.advance,
        );
      } else if (status === "picking_up") {
        if (!order.pickupPhotos) {
          addButton("Runner sends pickup photos", Orders.sendPickupPhotos);
        } else {
          addButton("Runner heads to drop-off", Orders.advance);
        }
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
        addButton(
          Orders.isGazebo(order)
            ? "Runner: I'm here + delivery photo"
            : "Runner: I'm here",
          Orders.advance,
        );
      } else if (status === "arrived") {
        var online = Orders.isGazebo(order) && order.paymentMethod === "online";
        addButton(
          online ? "Runner: payment received" : "Runner: cash received",
          function () {
            Orders.confirm("runner");
          },
        );
        if (Orders.isFrontDesk(order)) {
          addNote(
            "Front desk: the order closes when the runner confirms payment.",
          );
        } else {
          addButton("Customer: I received it", function () {
            Orders.confirm("customer");
          });
        }
      }

      if ((status === "choosing" || status === "buying") && !order.inQueue) {
        addButton("Runner: I'm in queue", Orders.notifyQueue);
      }

      addButton("Reset demo", Orders.reset, true);
    }

    CampusRunnersOrder.subscribe(render);
    render();
  }

  return { mount: mount };
})();
