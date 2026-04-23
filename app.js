const templates = {
  contract:
    "Проверь договор поставки. Контрагент просит предоплату 70%, срок поставки 45 дней, ответственность ограничена суммой договора, право на одностороннее расторжение только у них. Хочу понять риски и что исправить перед подписанием.",
  debt:
    "Покупатель не оплатил услуги на 2 800 000 тенге. Акт подписан, срок оплаты просрочен на 18 дней. Нужен план: претензия, доказательства, шанс взыскания и что писать контрагенту.",
  employment:
    "Сотрудник уволился, забрал клиентскую базу и пишет клиентам от имени новой компании. В договоре есть конфиденциальность и запрет разглашения. Какие шаги делать сейчас?",
  compliance:
    "Нужно оценить бизнес-процесс: компания собирает данные клиентов через сайт, хранит договоры и передает часть документов подрядчику. Хочу понять риски по комплаенсу и что исправить."
};

const scenarioCopy = {
  consultation: {
    title: "Первичный юридический разбор",
    placeholder: "Опишите спор, стороны, цель обращения, документы и сроки..."
  },
  contract: {
    title: "Предварительный анализ договора",
    placeholder: "Вставьте условия договора, спорные пункты, сроки, оплату, ответственность..."
  },
  claim: {
    title: "Претензионная стратегия",
    placeholder: "Опишите нарушение, сумму, доказательства, переписку и желаемый результат..."
  },
  business: {
    title: "Риск-анализ бизнеса",
    placeholder: "Опишите процесс, сбор данных, роли подрядчиков, документы и точки риска..."
  }
};

const threadConfigs = {
  "new-request": {
    scenario: "consultation",
    title: "Опишите юридическую ситуацию",
    description: "Коротко опишите кейс."
  },
  "contract-review": {
    scenario: "contract",
    title: "Разберем договор",
    description: "Вставьте ключевые условия."
  },
  "claim-strategy": {
    scenario: "claim",
    title: "Подготовим претензию",
    description: "Опишите нарушение и документы."
  }
};

const defaultThreadState = Object.fromEntries(
  Object.keys(threadConfigs).map((threadKey) => [threadKey, { messages: [] }])
);

const threadState = structuredClone(defaultThreadState);

const chatForm = document.querySelector("#chatForm");
const requestInput = document.querySelector("#request");
const scenarioInput = document.querySelector("#scenario");
const jurisdictionInput = document.querySelector("#jurisdiction");
const chatThread = document.querySelector("#chatThread");
const statusText = document.querySelector("#statusText");
const resetButton = document.querySelector("#resetButton");
const newChatButton = document.querySelector("#newChatButton");
const homeButton = document.querySelector("#homeButton");
const threadButtons = [...document.querySelectorAll("[data-thread]")];
const templateButtons = [...document.querySelectorAll("[data-template]")];
const sendButton = document.querySelector("#sendButton");

let currentThreadKey = "new-request";
let isSending = false;

templateButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyTemplate(button.dataset.template);
  });
});

threadButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openThread(button.dataset.thread);
  });
});

requestInput.addEventListener("input", autosizeTextarea);

requestInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

scenarioInput.addEventListener("change", () => {
  updateComposerPlaceholder();
});

resetButton.addEventListener("click", () => {
  threadState[currentThreadKey].messages = [];
  openThread(currentThreadKey);
  statusText.textContent = `Диалог "${getThreadLabel(currentThreadKey)}" очищен.`;
});

newChatButton.addEventListener("click", () => {
  threadState["new-request"].messages = [];
  openThread("new-request");
  statusText.textContent = "Открыт новый юридический запрос.";
});

homeButton.addEventListener("click", (event) => {
  event.preventDefault();
  openThread("new-request");
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSending) {
    return;
  }

  const request = requestInput.value.trim();
  if (!request) {
    requestInput.focus();
    return;
  }

  const activeThread = threadState[currentThreadKey];
  const userMessage = { role: "user", content: request };
  activeThread.messages.push(userMessage);

  appendUserMessage(request);
  requestInput.value = "";
  autosizeTextarea();

  const typingMessage = appendTypingMessage();
  setSendingState(true);
  statusText.textContent = "Lexora AI отправляет запрос в OpenAI...";
  scrollToBottom();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadKey: currentThreadKey,
        threadLabel: getThreadLabel(currentThreadKey),
        scenario: scenarioInput.value,
        jurisdiction: jurisdictionInput.value,
        messages: activeThread.messages
      })
    });

    const data = await response.json();
    typingMessage.remove();

    if (!response.ok) {
      throw new Error(data.error || "Не удалось получить ответ от OpenAI.");
    }

    const assistantText = data.reply?.trim() || "Пустой ответ от модели.";
    activeThread.messages.push({ role: "assistant", content: assistantText });
    appendAssistantMessage(assistantText);
    statusText.textContent = `Ответ готов${data.model ? ` (${data.model})` : ""}.`;
  } catch (error) {
    typingMessage.remove();
    const message = error instanceof Error ? error.message : "Неизвестная ошибка.";
    appendAssistantMessage(
      `## Не удалось получить ответ\n- ${message}\n- Проверьте, что локальный сервер запущен и переменная OPENAI_API_KEY задана.\n- После настройки можно отправить сообщение еще раз.`
    );
    statusText.textContent = "Ошибка подключения к AI. Нужна настройка сервера или ключа.";
  } finally {
    setSendingState(false);
    scrollToBottom();
  }
});

function openThread(threadKey) {
  const config = threadConfigs[threadKey] || threadConfigs["new-request"];
  currentThreadKey = threadKey;
  setActiveThread(threadKey);
  scenarioInput.value = config.scenario;
  renderCurrentThread();
  updateComposerPlaceholder();
  statusText.textContent = `Открыта вкладка: ${getThreadLabel(threadKey)}.`;
  requestInput.focus();
  scrollToBottom();
}

function renderCurrentThread() {
  const config = threadConfigs[currentThreadKey];
  const { messages } = threadState[currentThreadKey];
  chatThread.innerHTML = renderWelcomeMessage(config);
  bindThreadTemplateButtons();
  bindWelcomeTabs();

  messages.forEach((message) => {
    if (message.role === "user") {
      appendUserMessage(message.content);
      return;
    }

    appendAssistantMessage(message.content);
  });
}

function bindThreadTemplateButtons() {
  chatThread.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTemplate(button.dataset.template);
    });
  });
}

function bindWelcomeTabs() {
  const tabs = [...chatThread.querySelectorAll("[data-welcome-tab]")];
  const panels = [...chatThread.querySelectorAll("[data-welcome-panel]")];

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.welcomeTab;
      tabs.forEach((item) => {
        item.classList.toggle("is-active", item === tab);
      });
      panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.welcomePanel === target);
      });
    });
  });
}

function setActiveThread(threadKey) {
  threadButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.thread === threadKey);
  });
}

function renderWelcomeMessage(config) {
  return `
    <article class="message assistant">
      <div class="avatar">L</div>
      <div class="bubble">
        <p class="message-role">Lexora AI</p>
        <h2>${escapeHtml(config.title)}</h2>
        <p class="welcome-lead">${escapeHtml(config.description)}</p>
        <div class="welcome-tabs" role="tablist" aria-label="Подсказки">
          <button class="welcome-tab is-active" type="button" data-welcome-tab="quick">Кратко</button>
          <button class="welcome-tab" type="button" data-welcome-tab="workflow">Как это работает</button>
          <button class="welcome-tab" type="button" data-welcome-tab="docs">Что подготовить</button>
        </div>
        <div class="welcome-panels">
          <section class="welcome-panel is-active" data-welcome-panel="quick">
            <ul>
              <li>Опишите спор и цель.</li>
              <li>Выберите сценарий.</li>
              <li>Отправьте сообщение.</li>
            </ul>
          </section>
          <section class="welcome-panel" data-welcome-panel="workflow">
            <ul>
              <li>AI делает первичный черновик.</li>
              <li>Lexora выделяет риски и пробелы.</li>
              <li>Финальный ответ проверяет юрист.</li>
            </ul>
          </section>
          <section class="welcome-panel" data-welcome-panel="docs">
            <ul>
              <li>Договоры и приложения.</li>
              <li>Переписка и платежи.</li>
              <li>Даты, суммы и цель обращения.</li>
            </ul>
          </section>
        </div>
        <div class="starter-grid">
          <button class="starter-card" type="button" data-template="contract">
            <strong>Проверить договор</strong>
          </button>
          <button class="starter-card" type="button" data-template="debt">
            <strong>Взыскать задолженность</strong>
          </button>
          <button class="starter-card" type="button" data-template="employment">
            <strong>Трудовой спор</strong>
          </button>
          <button class="starter-card" type="button" data-template="compliance">
            <strong>Комплаенс</strong>
          </button>
        </div>
      </div>
    </article>
  `;
}

function applyTemplate(templateKey) {
  const template = templates[templateKey];
  if (!template) {
    return;
  }

  if (templateKey === "contract") {
    scenarioInput.value = "contract";
    if (currentThreadKey !== "contract-review") {
      currentThreadKey = "contract-review";
      setActiveThread(currentThreadKey);
      renderCurrentThread();
    }
  }

  if (templateKey === "debt") {
    scenarioInput.value = "claim";
    if (currentThreadKey !== "claim-strategy") {
      currentThreadKey = "claim-strategy";
      setActiveThread(currentThreadKey);
      renderCurrentThread();
    }
  }

  if (templateKey === "employment") {
    scenarioInput.value = "consultation";
    if (currentThreadKey !== "new-request") {
      currentThreadKey = "new-request";
      setActiveThread(currentThreadKey);
      renderCurrentThread();
    }
  }

  if (templateKey === "compliance") {
    scenarioInput.value = "business";
    if (currentThreadKey !== "new-request") {
      currentThreadKey = "new-request";
      setActiveThread(currentThreadKey);
      renderCurrentThread();
    }
  }

  updateComposerPlaceholder();
  requestInput.value = template;
  autosizeTextarea();
  requestInput.focus();
  statusText.textContent = `Шаблон "${getTemplateLabel(templateKey)}" подставлен. Можно отправлять запрос.`;
  scrollToBottom();
}

function appendUserMessage(text) {
  chatThread.insertAdjacentHTML(
    "beforeend",
    `
      <article class="message user">
        <div class="bubble">
          <p class="message-role">Вы</p>
          <p>${escapeHtml(text)}</p>
        </div>
        <div class="avatar">Вы</div>
      </article>
    `
  );
}

function appendAssistantMessage(text) {
  chatThread.insertAdjacentHTML(
    "beforeend",
    `
      <article class="message assistant">
        <div class="avatar">L</div>
        <div class="bubble">
          <p class="message-role">Lexora AI</p>
          ${formatAssistantText(text)}
        </div>
      </article>
    `
  );
}

function appendTypingMessage() {
  chatThread.insertAdjacentHTML(
    "beforeend",
    `
      <article class="message assistant" id="typingMessage">
        <div class="avatar">L</div>
        <div class="bubble">
          <p class="message-role">Lexora AI</p>
          <div class="typing" aria-label="Lexora печатает">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </article>
    `
  );

  return document.querySelector("#typingMessage");
}

function formatAssistantText(text) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    chunks.push(`<ul>${listItems.join("")}</ul>`);
    listItems = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushList();
      return;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      return;
    }

    if (line.startsWith("### ")) {
      flushList();
      chunks.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      return;
    }

    if (line.startsWith("## ")) {
      flushList();
      chunks.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      return;
    }

    if (line.startsWith("# ")) {
      flushList();
      chunks.push(`<h2>${escapeHtml(line.slice(2))}</h2>`);
      return;
    }

    flushList();
    chunks.push(`<p>${escapeHtml(line)}</p>`);
  });

  flushList();
  return chunks.join("");
}

function updateComposerPlaceholder() {
  requestInput.placeholder =
    scenarioCopy[scenarioInput.value]?.placeholder ||
    "Опишите кейс, приложите факты, даты, суммы, документы, цель обращения...";
}

function setSendingState(nextState) {
  isSending = nextState;
  sendButton.disabled = nextState;
  resetButton.disabled = nextState;
  newChatButton.disabled = nextState;
  homeButton.disabled = nextState;
  threadButtons.forEach((button) => {
    button.disabled = nextState;
  });
  templateButtons.forEach((button) => {
    button.disabled = nextState;
  });
  chatThread.querySelectorAll("[data-template]").forEach((button) => {
    button.disabled = nextState;
  });
}

function autosizeTextarea() {
  requestInput.style.height = "0px";
  requestInput.style.height = `${Math.min(requestInput.scrollHeight, 220)}px`;
}

function scrollToBottom() {
  chatThread.scrollTop = chatThread.scrollHeight;
}

function getThreadLabel(threadKey) {
  if (threadKey === "contract-review") {
    return "Проверка договора";
  }

  if (threadKey === "claim-strategy") {
    return "Претензия контрагенту";
  }

  return "Новый юридический запрос";
}

function getTemplateLabel(templateKey) {
  if (templateKey === "contract") {
    return "Договоры";
  }

  if (templateKey === "debt") {
    return "Претензии";
  }

  if (templateKey === "employment") {
    return "Консультация";
  }

  if (templateKey === "compliance") {
    return "Комплаенс";
  }

  return "Сценарий";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

openThread("new-request");
autosizeTextarea();
