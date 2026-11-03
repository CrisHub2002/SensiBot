(() => {
  "use strict";

  const MAX_CHARS = 500;
  const MIN_CONFIDENCE = 40;

  const TONES = {
    halago: {
      label: "Halago",
      emoji: "😊",
      description: "Un mensaje positivo o de admiración."
    },
    insulto: {
      label: "Insulto",
      emoji: "😠",
      description: "Un mensaje negativo u ofensivo."
    },
    pregunta: {
      label: "Pregunta",
      emoji: "❓",
      description: "Una consulta o una petición de información."
    },
    neutro: {
      label: "Neutro",
      emoji: "😐",
      description: "Un mensaje sin una carga emocional clara."
    }
  };

  const elements = {
    status: document.getElementById("model-status"),
    statusText: document.getElementById("model-status-text"),
    form: document.getElementById("analyze-form"),
    message: document.getElementById("message"),
    counter: document.getElementById("counter"),
    fieldError: document.getElementById("field-error"),
    analyzeButton: document.getElementById("analyze-btn"),
    buttonLabel: document.getElementById("button-label"),
    examples: [...document.querySelectorAll(".example")],
    resultPane: document.getElementById("result-pane"),
    resultIdle: document.getElementById("result-idle"),
    idleTitle: document.getElementById("idle-title"),
    idleText: document.getElementById("idle-text"),
    resultLoading: document.getElementById("result-loading"),
    resultError: document.getElementById("result-error"),
    resultErrorText: document.getElementById("result-error-text"),
    resultContent: document.getElementById("result-content"),
    topResult: document.getElementById("top-result"),
    topEmoji: document.getElementById("top-emoji"),
    topLabel: document.getElementById("top-label"),
    topDescription: document.getElementById("top-description"),
    topConfidence: document.getElementById("top-confidence"),
    lowConfidence: document.getElementById("low-confidence"),
    predictionList: document.getElementById("prediction-list")
  };

  const defaultIdleTitle = elements.idleTitle.textContent;
  const defaultIdleText = elements.idleText.innerHTML;

  const state = {
    ready: false,
    busy: false,
    hasResult: false
  };

  bindEvents();
  updateCounter();
  updateButton();
  initialize();

  function bindEvents() {
    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      analyzeMessage();
    });

    elements.message.addEventListener("input", () => {
      hideFieldError();
      updateCounter();
      updateButton();
    });

    elements.message.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (!elements.analyzeButton.disabled) elements.form.requestSubmit();
      }
    });

    elements.examples.forEach((button) => {
      button.addEventListener("click", () => {
        if (!state.ready || state.busy) return;

        elements.message.value = button.dataset.text || "";
        hideFieldError();
        updateCounter();
        updateButton();
        elements.form.requestSubmit();
      });
    });
  }

  async function initialize() {
    if (window.location.protocol === "file:") {
      setStatus("error", "Sin servidor");
      setIdleCopy(
        "Abre la página con el servidor",
        "No funciona con doble clic. Ejecuta iniciar.bat o py servidor.py y abre la dirección que aparece."
      );
      return;
    }

    try {
      const response = await fetch("./api/health", {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });

      if (!response.ok) throw new Error("El servidor no respondió");

      const data = await response.json();

      if (!data.configured) {
        setStatus("error", "Falta la API key");
        setIdleCopy(
          "El modelo no está configurado",
          "Añade tu clave ML4KIDS_API_KEY al archivo .env y reinicia el servidor."
        );
        return;
      }

      state.ready = true;
      setStatus("ready", "Modelo conectado");
      setIdleCopy(defaultIdleTitle, defaultIdleText);
    } catch (error) {
      console.error(error);
      setStatus("error", "Sin conexión");
      setIdleCopy(
        "No se pudo conectar con el servidor",
        "Comprueba que iniciar.bat o py servidor.py siga en ejecución y vuelve a cargar la página."
      );
    } finally {
      updateButton();
    }
  }

  async function analyzeMessage() {
    if (!state.ready || state.busy) return;

    const text = elements.message.value.trim();

    if (!text) {
      showFieldError("Escribe un mensaje antes de analizarlo.");
      elements.message.focus();
      return;
    }

    state.busy = true;
    hideFieldError();
    setResultState("loading");
    updateButton();

    try {
      const response = await fetch("./api/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ text })
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo consultar el modelo.");
      }

      const predictions = normalizePredictions(payload?.predictions);

      if (predictions.length === 0) {
        throw new Error("El modelo no devolvió ninguna predicción.");
      }

      renderPredictions(predictions);
      state.hasResult = true;
      setResultState("content");

      if (window.innerWidth < 900) {
        elements.resultPane.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (error) {
      console.error(error);
      elements.resultErrorText.textContent = getFriendlyError(error);
      setResultState("error");
    } finally {
      state.busy = false;
      updateButton();
    }
  }

  function renderPredictions(predictions) {
    const top = predictions[0];
    const topTone = getTone(top.label);
    const topConfidence = Math.round(top.confidence);

    elements.topResult.dataset.tone = topTone.key;
    elements.topEmoji.textContent = topTone.emoji;
    elements.topLabel.textContent = topTone.label;
    elements.topDescription.textContent = topTone.description;
    elements.topConfidence.textContent = `${topConfidence}%`;
    elements.lowConfidence.hidden = top.confidence >= MIN_CONFIDENCE;
    elements.predictionList.replaceChildren();

    predictions.forEach((prediction, index) => {
      const tone = getTone(prediction.label);
      const confidence = Math.round(prediction.confidence);

      const item = document.createElement("li");
      item.className = index === 0 ? "prediction is-top" : "prediction";
      item.dataset.tone = tone.key;
      item.style.setProperty("--delay", `${index * 85}ms`);

      const head = document.createElement("div");
      head.className = "prediction-head";

      const name = document.createElement("span");
      name.className = "prediction-name";

      const emoji = document.createElement("span");
      emoji.className = "prediction-emoji";
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = tone.emoji;

      name.append(emoji, document.createTextNode(tone.label));

      const value = document.createElement("span");
      value.className = "prediction-value";
      value.textContent = `${confidence}%`;

      const bar = document.createElement("div");
      bar.className = "bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${tone.label}: ${confidence}%`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(confidence));

      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.setAttribute("aria-hidden", "true");

      bar.append(fill);
      head.append(name, value);
      item.append(head, bar);
      elements.predictionList.append(item);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fill.style.width = `${prediction.confidence}%`;
        });
      });
    });
  }

  function normalizePredictions(rawPredictions) {
    if (!Array.isArray(rawPredictions)) return [];

    return rawPredictions
      .map((prediction) => {
        const label = typeof prediction?.class_name === "string" ? prediction.class_name.trim() : "";
        const confidence = Number(prediction?.confidence);
        return {
          label,
          confidence: Number.isFinite(confidence) ? Math.min(100, Math.max(0, confidence)) : 0
        };
      })
      .filter((prediction) => prediction.label)
      .sort((a, b) => b.confidence - a.confidence);
  }

  function getTone(label) {
    const key = normalizeText(label);

    if (Object.prototype.hasOwnProperty.call(TONES, key)) {
      return { key, ...TONES[key] };
    }

    return {
      key: "neutro",
      label: label || "Desconocido",
      emoji: "💬",
      description: "El modelo devolvió una categoría no reconocida."
    };
  }

  function setResultState(view) {
    elements.resultIdle.hidden = view !== "idle";
    elements.resultLoading.hidden = view !== "loading";
    elements.resultError.hidden = view !== "error";
    elements.resultContent.hidden = view !== "content";
  }

  function setIdleCopy(title, html) {
    elements.idleTitle.textContent = title;
    elements.idleText.innerHTML = html;
  }

  function updateCounter() {
    const length = elements.message.value.length;

    elements.counter.textContent = `${length} / ${MAX_CHARS}`;
    elements.counter.classList.toggle("is-near-limit", length >= MAX_CHARS - 50 && length < MAX_CHARS);
    elements.counter.classList.toggle("is-limit", length >= MAX_CHARS);
  }

  function updateButton() {
    const hasText = elements.message.value.trim().length > 0;
    const disabled = !state.ready || !hasText || state.busy;

    elements.analyzeButton.disabled = disabled;
    elements.analyzeButton.classList.toggle("is-busy", state.busy);
    elements.analyzeButton.setAttribute("aria-busy", String(state.busy));
    elements.buttonLabel.textContent = state.busy
      ? "Analizando…"
      : state.hasResult
        ? "Analizar de nuevo"
        : "Analizar mensaje";

    elements.examples.forEach((button) => {
      button.disabled = !state.ready || state.busy;
    });
  }

  function showFieldError(message) {
    elements.fieldError.textContent = message;
    elements.fieldError.hidden = false;
    elements.message.setAttribute("aria-invalid", "true");
  }

  function hideFieldError() {
    elements.fieldError.hidden = true;
    elements.fieldError.textContent = "";
    elements.message.removeAttribute("aria-invalid");
  }

  function setStatus(status, text) {
    elements.status.dataset.state = status;
    elements.statusText.textContent = text;
  }

  function getFriendlyError(error) {
    const message = error instanceof Error ? error.message : "";

    if (!message || /fetch|network|failed to fetch/i.test(message)) {
      return "No se pudo conectar con el servidor local. Comprueba que siga en ejecución e inténtalo de nuevo.";
    }

    return message;
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }
})();
