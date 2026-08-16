// activity.js — Manages the practice (game) screen.
// Exports: initActivity()

import * as db from "./db.js";
import { selectSentences } from "./engine.js";

const SESSION_KEY = "customcloze_session";

// Module-level session state — not exported
let currentSession = null;

// ---------------------------------------------------------------------------
// Public init — called once by app.js
// ---------------------------------------------------------------------------

export async function initActivity() {
  document.getElementById("start-btn").addEventListener("click", () => startSession());
  document.getElementById("back-btn-active").addEventListener("click", resetToIdle);
  document.getElementById("check-btn").addEventListener("click", checkAnswers);
  document.getElementById("back-btn-graded").addEventListener("click", resetToIdle);
  document.getElementById("next-btn").addEventListener("click", () => startSession(currentSession?.gramCat));

  // "Go to manage" link inside no-words-msg
  document.getElementById("go-manage-link").addEventListener("click", (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("show-screen", { detail: "screen-manage" }));
  });

  // Keep category dropdown in sync when the DB changes
  window.addEventListener("db-updated", renderIdle);

  // Restore a session saved before a page refresh
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      currentSession = JSON.parse(saved);
      renderActivePhase();
      return;
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  await renderIdle();
}

// ---------------------------------------------------------------------------
// Idle phase
// ---------------------------------------------------------------------------

async function renderIdle() {
  const categories = await db.getCategories();
  const catSelect = document.getElementById("cat-select");
  const startBtn  = document.getElementById("start-btn");
  const noWordsMsg = document.getElementById("no-words-msg");

  catSelect.innerHTML = "";
  if (categories.length === 0) {
    catSelect.style.display = "none";
    startBtn.style.display  = "none";
    noWordsMsg.style.display = "block";
  } else {
    catSelect.style.display  = "";
    startBtn.style.display   = "";
    noWordsMsg.style.display = "none";
    
    // Add "All Categories" option
    const allOpt = document.createElement("option");
    allOpt.value = "ALL";
    allOpt.textContent = "All Categories";
    catSelect.appendChild(allOpt);
    
    for (const cat of categories) {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    }
  }

  document.body.className = "phase-idle";
}

// ---------------------------------------------------------------------------
// Start session
// ---------------------------------------------------------------------------

async function startSession(gramCat) {
  if (!gramCat) {
    gramCat = document.getElementById("cat-select").value;
  }
  if (!gramCat) return;

  // Convert "ALL" to null so selectSentences retrieves all words
  const selectedCat = gramCat === "ALL" ? null : gramCat;
  const result = await selectSentences(selectedCat);

  if (!result) {
    document.getElementById("no-words-msg").style.display = "block";
    return;
  }

  const { sessionWords, wordBank } = result;

  // Build blanks array — one entry per blank across all sentences, in display order
  const blanks = sessionWords.map((sw, sentenceIndex) => ({ sentenceIndex, chipId: null }));

  currentSession = { gramCat, sessionWords, wordBank, blanks };
  renderActivePhase();
  saveSession();
}

// ---------------------------------------------------------------------------
// Active phase rendering
// ---------------------------------------------------------------------------

function renderActivePhase() {
  const { sessionWords, wordBank, blanks } = currentSession;

  // ── Sentence list ────────────────────────────────────────────────────────
  const sentenceList = document.getElementById("sentence-list");
  sentenceList.innerHTML = "";

  sessionWords.forEach((sw, sentenceIndex) => {
    const card = document.createElement("div");
    card.className = "sentence-card";

    sw.parts.forEach((part) => {
      if (part.type === "text") {
        const span = document.createElement("span");
        span.textContent = part.text;
        card.appendChild(span);
      } else if (part.type === "blank") {
        const blankEntry = blanks.find(b => b.sentenceIndex === sentenceIndex);
        const btn = document.createElement("button");
        btn.className = "blank-btn";
        btn.dataset.sentenceIndex = sentenceIndex;

        if (blankEntry?.chipId) {
          const chip = currentSession.wordBank.find(c => c.id === blankEntry.chipId);
          btn.textContent = chip ? chip.text : "_____";
          btn.classList.add("filled");
        } else {
          btn.textContent = "_____";
        }

        btn.addEventListener("click", () => tapBlank(sentenceIndex));
        card.appendChild(btn);
      }
    });

    sentenceList.appendChild(card);
  });

  // ── Chip area ────────────────────────────────────────────────────────────
  const chipArea = document.getElementById("chip-area");
  chipArea.innerHTML = "";

  for (const chip of wordBank) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.chipId = chip.id;
    btn.textContent = chip.text;

    // If this chip is already placed (restored session), mark it used
    const isUsed = blanks.some(b => b.chipId === chip.id);
    if (isUsed) {
      btn.classList.add("used");
      btn.disabled = true;
    }

    btn.addEventListener("click", () => tapChip(chip.id));
    chipArea.appendChild(btn);
  }

  // ── Check button state ───────────────────────────────────────────────────
  const allFilled = blanks.every(b => b.chipId !== null);
  document.getElementById("check-btn").disabled = !allFilled;

  // ── Pad sentence list so content is not hidden behind word bank bar ──────
  document.body.className = "phase-active";
  // Measure after phase switch so the bar is visible
  requestAnimationFrame(() => {
    const barHeight = document.getElementById("word-bank-bar").getBoundingClientRect().height;
    sentenceList.style.paddingBottom = barHeight + "px";
  });
}

// ---------------------------------------------------------------------------
// Chip / blank interaction
// ---------------------------------------------------------------------------

function tapChip(chipId) {
  const { blanks, wordBank } = currentSession;

  // Find first empty blank
  const emptyEntry = blanks.find(b => b.chipId === null);
  if (!emptyEntry) return;

  emptyEntry.chipId = chipId;

  // Mark chip used
  const chipBtn = document.querySelector(`[data-chip-id="${chipId}"]`);
  if (chipBtn) {
    chipBtn.classList.add("used");
    chipBtn.disabled = true;
  }

  // Update blank button
  const blankBtn = document.querySelector(`[data-sentence-index="${emptyEntry.sentenceIndex}"]`);
  if (blankBtn) {
    const chip = wordBank.find(c => c.id === chipId);
    blankBtn.textContent = chip ? chip.text : chipId;
    blankBtn.classList.add("filled");
    blankBtn.classList.remove("correct", "incorrect");
  }

  // Enable check button if all blanks are filled
  if (blanks.every(b => b.chipId !== null)) {
    document.getElementById("check-btn").disabled = false;
  }

  saveSession();
}

function tapBlank(sentenceIndex) {
  const { blanks, wordBank } = currentSession;

  const entry = blanks.find(b => b.sentenceIndex === sentenceIndex);
  if (!entry || entry.chipId === null) return;

  const chipId = entry.chipId;
  entry.chipId = null;

  // Re-enable chip
  const chipBtn = document.querySelector(`[data-chip-id="${chipId}"]`);
  if (chipBtn) {
    chipBtn.classList.remove("used");
    chipBtn.disabled = false;
  }

  // Reset blank button
  const blankBtn = document.querySelector(`[data-sentence-index="${sentenceIndex}"]`);
  if (blankBtn) {
    blankBtn.textContent = "_____";
    blankBtn.classList.remove("filled", "correct", "incorrect");
  }

  // Disable check button
  document.getElementById("check-btn").disabled = true;

  saveSession();
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function checkAnswers() {
  const { blanks, sessionWords, wordBank } = currentSession;
  let score = 0;

  for (const entry of blanks) {
    const chip = wordBank.find(c => c.id === entry.chipId);
    const sw   = sessionWords[entry.sentenceIndex];
    const blankPart = sw.parts.find(p => p.type === "blank");
    const correct = chip && blankPart &&
      chip.text.toLowerCase() === blankPart.answer.toLowerCase();
    if (correct) score++;

    // Record history
    const status = correct ? "correct" : "incorrect";
    db.upsertHistory({ wordId: sw.wordId, sentenceHash: sw.sentenceHash, status });
  }

  localStorage.removeItem(SESSION_KEY);
  renderGradedPhase(score);
}

function renderGradedPhase(score) {
  const { sessionWords, wordBank, blanks } = currentSession;
  const gradedList = document.getElementById("graded-sentence-list");
  gradedList.innerHTML = "";

  sessionWords.forEach((sw, sentenceIndex) => {
    const entry = blanks.find(b => b.sentenceIndex === sentenceIndex);
    const chip  = wordBank.find(c => c.id === entry?.chipId);
    const blankPart = sw.parts.find(p => p.type === "blank");
    const isCorrect = chip && blankPart &&
      chip.text.toLowerCase() === blankPart.answer.toLowerCase();

    const card = document.createElement("div");
    card.className = "sentence-card";

    sw.parts.forEach((part) => {
      if (part.type === "text") {
        const span = document.createElement("span");
        span.textContent = part.text;
        card.appendChild(span);
      } else if (part.type === "blank") {
        const btn = document.createElement("button");
        btn.className = "blank-btn graded";
        btn.textContent = chip ? chip.text : "_____";

        if (isCorrect) {
          btn.classList.add("correct");
        } else {
          btn.classList.add("incorrect");
          // Reveal panel (hidden by default, toggled by clicking the blank)
          const reveal = document.createElement("div");
          reveal.className = "correct-answer-reveal";
          reveal.style.display = "none";
          reveal.textContent = `✓ ${blankPart?.answer ?? ""}`;

          btn.addEventListener("click", () => {
            reveal.style.display = reveal.style.display === "none" ? "block" : "none";
          });
          card.appendChild(btn);
          card.appendChild(reveal);
          return; // skip the default append below
        }

        card.appendChild(btn);
      }
    });

    gradedList.appendChild(card);
  });

  document.getElementById("score-display").textContent =
    `Score: ${score} / ${sessionWords.length}`;

  document.body.className = "phase-graded";
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetToIdle() {
  currentSession = null;
  localStorage.removeItem(SESSION_KEY);
  renderIdle();
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

function saveSession() {
  if (currentSession) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
  }
}
