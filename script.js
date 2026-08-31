// Use Supabase for auth and storage. If Supabase isn't configured, app falls back to localStorage for flashcards.
let supabase = null;
let currentUser = null;

// Administrator email — UI and RLS will treat this account as the superuser
const ADMIN_EMAIL = 'hardisun@gmail.com';

// Ensure admin intro is hidden as early as possible to avoid flicker or stale state
document.addEventListener('DOMContentLoaded', () => {
  try {
    const ai = document.getElementById('adminIntro');
    if (ai) ai.style.display = 'none';
  } catch (e) {}
});

let flashcards = [];
let currentIndex = 0;
let isFlipped = false;
// displayOrder is an array of indices (shuffled) used for sequential browsing (next/prev)
let displayOrder = null;

// Helper: Fisher-Yates shuffle
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function regenerateDisplayOrder(preserveLogicalIndex) {
  // preserveLogicalIndex: an index in flashcards (logical index) to keep as the current displayed card
  if (!flashcards || flashcards.length === 0) { displayOrder = null; currentIndex = 0; return; }
  const indices = flashcards.map((_, i) => i);
  displayOrder = shuffleArray(indices);
  if (typeof preserveLogicalIndex === 'number') {
    const pos = displayOrder.indexOf(preserveLogicalIndex);
    currentIndex = pos >= 0 ? pos : 0;
  } else {
    currentIndex = 0;
  }
}

// Helper: ensure Spanish sentences display with an appropriate opening inverted punctuation
// Adds '¿' when the displayed string ends with '?' and doesn't already start with '¿'
// Adds '¡' when the displayed string ends with '!' and doesn't already start with '¡'
function ensureSpanishQuestionMark(s) {
  if (!s || typeof s !== 'string') return s;
  const t = s.trim();
  // Match trailing punctuation like '?!' or '!!' etc.
  const m = t.match(/([!?]+)\s*$/);
  if (m) {
    const punctSeq = m[1];
    const last = punctSeq[punctSeq.length - 1];
    if (last === '!') {
      if (!t.startsWith('¡')) return '¡' + t;
    } else if (last === '?') {
      if (!t.startsWith('¿')) return '¿' + t;
    }
  }
  return t;
}

// Mode & practice state
let mode = 'practice'; // 'edit' or 'practice'
let practiceOrder = [];
let practiceIndex = 0;
let practiceScore = 0;
let practiceTotal = 0;

// Initialize: fetch config from server and setup supabase client if configured
window.onload = async function() {
  try {
    // First, allow static embedding of config for static hosts (GitHub Pages).
    // If deploy target injected window.__SUPABASE_CONFIG__, use that; otherwise fall back to /config endpoint.
    let cfg = null;
    if (window.__SUPABASE_CONFIG__ && window.__SUPABASE_CONFIG__.supabaseUrl) {
      console.log('Using embedded Supabase config from window.__SUPABASE_CONFIG__');
      cfg = window.__SUPABASE_CONFIG__;
    } else {
      const res = await fetch('/config');
      if (!res.ok) throw new Error('no config');
      cfg = await res.json();
    }

    // If the Supabase UMD client is loaded via CDN, use the global; otherwise, try dynamic import
    // Debug logging to help diagnose invalid URL issues
    console.debug('Supabase config (raw):', cfg);
    console.debug('supabaseUrl type:', typeof cfg?.supabaseUrl, 'value:', String(cfg?.supabaseUrl));

    if (window.supabase && typeof window.supabase.createClient === 'function') {
      supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    } else {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      } catch (impErr) {
        console.warn('Failed to load supabase-js dynamically', impErr);
        supabase = null;
      }
    }

    if (supabase) {
      // get session (v2 API)
      const { data: { session } } = await supabase.auth.getSession();
      currentUser = session?.user ?? null;

      // listen for auth changes
      supabase.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user ?? null;
        updateAuthUI();
        // Only load DB data when a user is signed in
        if (currentUser) loadFlashcardsFromDB();
      });

      if (currentUser) {
        updateAuthUI();
        await loadFlashcardsFromDB();
      } else {
        // Not signed in: show login screen only (no anonymous access)
        updateAuthUI();
      }
    } else {
      console.warn('Supabase client not available');
      // Show login UI so users must authenticate before using the app
      updateAuthUI();
    }
  } catch (err) {
    // no supabase configured — use localStorage fallback
    console.warn('Supabase not configured, using localStorage fallback', err);
    loadFlashcardsFromLocal();
  }
};

function updateAuthUI() {
  const loginBox = document.getElementById('loginBox');
  const userInfo = document.getElementById('userInfo');
  const editArea = document.getElementById('editArea');
  const deleteBtn = document.getElementById('btnDelete');
  const addBtn = document.getElementById('btnAdd');
  const adminIntro = document.getElementById('adminIntro');
  const adminMsg = document.getElementById('adminMsg');
  const containerEl = document.querySelector('.container');

  // default-hide admin intro until we determine admin status
  if (adminIntro) adminIntro.style.display = 'none';

  const isAdmin = Boolean(currentUser && currentUser.email && currentUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());

  if (currentUser) {
    if (loginBox) loginBox.style.display = 'none';
    if (userInfo) userInfo.style.display = 'block';
    if (containerEl) containerEl.style.display = 'block';
    // hide header fallback sign-out when the main userInfo box is visible
    const btnTop = document.getElementById('btnSignOutTop'); if (btnTop) btnTop.style.display = 'none';

    // Only show edit controls (add/list/delete) to the admin account. Admin always sees the add form below flashcards.
    if (editArea) {
      editArea.style.display = isAdmin ? 'block' : 'none';
    }
    if (deleteBtn) deleteBtn.style.display = isAdmin ? 'inline-block' : 'none';
    if (addBtn) addBtn.style.display = isAdmin ? 'inline-block' : 'none';
    if (adminIntro) adminIntro.style.display = isAdmin ? 'block' : 'none';
    if (adminMsg) { adminMsg.style.display = 'none'; adminMsg.innerText = ''; adminMsg.style.color='red'; }


    // If a non-admin ended up in edit mode, switch them to practice for safety
    if (!isAdmin && mode === 'edit') setMode('practice');
  } else {
    // Not signed in: require login — hide the app and show login box
    if (loginBox) loginBox.style.display = 'block';
    if (userInfo) userInfo.style.display = 'none';
    if (containerEl) containerEl.style.display = 'none';

    // Hide edit controls explicitly
    if (editArea) editArea.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
    if (adminIntro) adminIntro.style.display = 'none';
    if (adminMsg) { adminMsg.style.display = 'none'; adminMsg.innerText = ''; }


    // Ensure we are not in edit mode
    if (mode === 'edit') setMode('practice');
  }

  // Apply the UI mode to ensure practice/edit areas are shown/hidden correctly
  try { setMode(mode); } catch (e) { /* ignore if not defined yet */ }

  // Debug line: show user email and role at bottom-left for troubleshooting
  try {
    const dbg = document.getElementById('debugUser');
    if (dbg) {
      const role = currentUser ? (currentUser.email && currentUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user') : 'anonymous';
      const email = currentUser?.email || (supabase ? 'no-session' : 'no-supabase');
      dbg.innerText = `${email} - ${role}`;
      dbg.style.display = 'block';
    }
  } catch (e) { /* ignore */ }
}

async function supabaseSignUp() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  msg.style.display = 'none';

  if (!supabase) { msg.innerText = 'Server not configured for Supabase.'; msg.style.display = 'block'; return; }

  // Basic client-side validation
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    msg.innerText = 'Please enter a valid email address.';
    msg.style.display = 'block';
    return;
  }
  if (!password || password.length < 6) {
    msg.innerText = 'Please enter a password of at least 6 characters.';
    msg.style.display = 'block';
    return;
  }

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) { msg.innerText = error.message; msg.style.display = 'block'; }
  else { msg.innerText = 'Check your email to confirm (if required).'; msg.style.display = 'block'; }
}

async function supabaseSignIn() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  msg.style.display = 'none';

  if (!supabase) { msg.innerText = 'Server not configured for Supabase.'; msg.style.display = 'block'; return; }

  if (!email) {
    msg.innerText = 'Please enter your email.';
    msg.style.display = 'block';
    return;
  }
  if (!password) {
    msg.innerText = 'Please enter your password.';
    msg.style.display = 'block';
    return;
  }

  console.debug('Attempting sign in for', email, 'password length:', password ? password.length : 0);
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error('supabase signIn error object:', error);
    msg.innerText = error.message || JSON.stringify(error);
    msg.style.display = 'block';
  } else {
    console.debug('signIn success', data);
    currentUser = data.user;

    // force-hide login UI and show admin edit area if this user is admin
    const loginBoxEl = document.getElementById('loginBox');
    if (loginBoxEl) loginBoxEl.style.display = 'none';

    updateAuthUI();
    // extra safeguard: if admin, explicitly un-hide edit form
    try {
      const isAdmin = currentUser && currentUser.email && currentUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      if (isAdmin) {
        const editArea = document.getElementById('editArea');
        if (editArea) editArea.style.display = 'block';
        const addBtn = document.getElementById('btnAdd'); if (addBtn) addBtn.style.display = 'inline-block';
        const deleteBtn = document.getElementById('btnDelete'); if (deleteBtn) deleteBtn.style.display = 'inline-block';
        const adminIntro = document.getElementById('adminIntro'); if (adminIntro) adminIntro.style.display = 'block';
      } else {
        const adminIntro = document.getElementById('adminIntro'); if (adminIntro) adminIntro.style.display = 'none';
      }
    } catch(e) { console.error('post-signin UI patch failed', e); }

    await loadFlashcardsFromDB();
  }
}

async function signOut() {
  currentUser = null; updateAuthUI(); }

// LocalStorage fallback
function loadFlashcardsFromLocal() {
  flashcards = JSON.parse(localStorage.getItem('myFlashcards')) || [];
  currentIndex = 0;
  // Build or reset display order when loading local data
  regenerateDisplayOrder();
  displayCard();
}

function saveFlashcardsToLocal() { localStorage.setItem('myFlashcards', JSON.stringify(flashcards)); }

// Supabase DB functions
async function loadFlashcardsFromDB() {
  if (!supabase) { console.warn('Supabase client not available — cannot load DB flashcards.'); updateAuthUI(); return; }

  try {
    // If signed in, determine admin status and load appropriate cards
    if (currentUser) {
      // Fetch admin IDs (requires SELECT on public.admins allowed)
      let adminIds = [];
      try {
        const { data: admins, error: adminErr } = await supabase.from('admins').select('user_id');
        if (!adminErr && admins && admins.length > 0) adminIds = admins.map(a => a.user_id).filter(Boolean);
      } catch (e) {
        console.debug('could not fetch admins list', e);
      }

      const isAdmin = adminIds.includes(currentUser.id);

      if (isAdmin) {
        // Admin: load all flashcards
        const { data, error } = await supabase
          .from('flashcards')
          .select('id, english, spanish, created_at')
          .order('created_at', { ascending: true });
        if (error) throw error;
        flashcards = (data || []).map(r => ({ id: r.id, english: r.english, spanish: r.spanish }));
        // build displayOrder (shuffled) and show first card
        regenerateDisplayOrder();
        displayCard();
        return;
      }

      // Non-admin user: only show admin-owned flashcards (admins are the only creators)
      if (adminIds.length === 0) {
        // No admins recorded — nothing to show
        flashcards = [];
        currentIndex = 0;
        displayCard();
        return;
      }

      const { data, error } = await supabase
        .from('flashcards')
        .select('id, english, spanish, created_at')
        .in('user_id', adminIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      flashcards = (data || []).map(r => ({ id: r.id, english: r.english, spanish: r.spanish }));
      // build displayOrder (shuffled) and show first card
      regenerateDisplayOrder();
      displayCard();
      return;
    }

    // Anonymous user: try to load admin-owned flashcards explicitly.
    // 1) Try to fetch admin user_ids (requires SELECT on public.admins allowed)
    let adminIds = [];
    try {
      const { data: admins, error: adminErr } = await supabase.from('admins').select('user_id');
      if (!adminErr && admins && admins.length > 0) {
        adminIds = admins.map(a => a.user_id).filter(Boolean);
      }
    } catch (e) {
      console.debug('could not fetch admins list', e);
    }

    // 2) If we got adminIds, query flashcards for those ids; otherwise, fall back to an unrestricted select (RLS will filter server-side)
    let result;
    if (adminIds.length > 0) {
      result = await supabase.from('flashcards').select('id, english, spanish, created_at').in('user_id', adminIds).order('created_at', { ascending: true });
    } else {
      result = await supabase.from('flashcards').select('id, english, spanish, created_at').order('created_at', { ascending: true });
    }

    if (result.error) {
      throw result.error;
    }

    const data = result.data || [];
    flashcards = data.map(r => ({ id: r.id, english: r.english, spanish: r.spanish }));
    // build display order and show first card
    regenerateDisplayOrder();
    displayCard();
  } catch (error) {
    console.error('load error', error);
    // if DB fails, fallback to local storage so UI still works offline
    loadFlashcardsFromLocal();
  }
}

async function addCard() {
  const english = document.getElementById('englishInput').value.trim();
  const spanish = document.getElementById('spanishInput').value.trim();
  if (!english || !spanish) return;

  if (supabase && currentUser) {
    const { data, error } = await supabase.from('flashcards').insert([{ user_id: currentUser.id, english, spanish }]).select();
    if (error) { console.error('insert error', error); return; }
    flashcards.push({ id: data[0].id, english: data[0].english, spanish: data[0].spanish });
  } else {
    flashcards.push({ english, spanish });
    saveFlashcardsToLocal();
  }

  document.getElementById('englishInput').value = '';
  document.getElementById('spanishInput').value = '';
  // After inserting, regenerate displayOrder and position to the newly added logical index
  regenerateDisplayOrder(flashcards.length - 1);
  displayCard();
}

// Delete currently-displayed card (admin-only in UI; RLS enforces server-side access)
async function deleteCard() {
  if (flashcards.length === 0) return;
  const card = flashcards[currentIndex];
  if (!card) return;

  if (supabase && currentUser && card.id) {
    const { error } = await supabase.from('flashcards').delete().eq('id', card.id);
    if (error) { console.error('delete error', error); return; }
    // remove locally
    // currentIndex here is position within displayOrder; map to logical index if needed
    const logicalIndex = (displayOrder && Array.isArray(displayOrder) && displayOrder.length === flashcards.length)
      ? displayOrder[currentIndex]
      : currentIndex;
    // remove by logical index
    flashcards.splice(logicalIndex, 1);
  } else {
    // local fallback
    const logicalIndex = (displayOrder && Array.isArray(displayOrder) && displayOrder.length === flashcards.length)
      ? displayOrder[currentIndex]
      : currentIndex;
    flashcards.splice(logicalIndex, 1);
    saveFlashcardsToLocal();
  }

  if (flashcards.length === 0) { displayOrder = null; currentIndex = 0; displayCard(); return; }
  // rebuild displayOrder after a deletion; keep currentIndex within bounds
  regenerateDisplayOrder();
  if (currentIndex >= flashcards.length) currentIndex = Math.max(0, flashcards.length - 1);
  displayCard();
}

// Delete flashcards by English text (case-insensitive). Admin-only in UI; RLS enforces server-side access.
async function deleteByEnglish() {
  const val = (document.getElementById('deleteEnglishInput') || {}).value;
  const msgEl = document.getElementById('adminMsg');
  if (msgEl) { msgEl.style.display = 'none'; msgEl.innerText = ''; msgEl.style.color = 'red'; }
  if (!val || !val.trim()) {
    if (msgEl) { msgEl.innerText = 'Please enter the English text to delete.'; msgEl.style.display = 'block'; }
    return;
  }
  const search = val.trim();

  if (supabase && currentUser) {
    // Find matching rows (case-insensitive)
    const { data, error } = await supabase.from('flashcards').select('id,english,spanish').ilike('english', search);
    if (error) { console.error('lookup error', error); if (msgEl) { msgEl.innerText = error.message || JSON.stringify(error); msgEl.style.display = 'block'; } return; }
    if (!data || data.length === 0) { if (msgEl) { msgEl.innerText = 'No matching card found.'; msgEl.style.display = 'block'; } return; }

    const ids = data.map(d => d.id);
    const { error: delErr } = await supabase.from('flashcards').delete().in('id', ids);
    if (delErr) { console.error('delete error', delErr); if (msgEl) { msgEl.innerText = delErr.message || JSON.stringify(delErr); msgEl.style.display = 'block'; } return; }

    // update local flashcards cache
    flashcards = flashcards.filter(f => !ids.includes(f.id));
    if (currentIndex >= flashcards.length) currentIndex = Math.max(0, flashcards.length - 1);
    displayCard();
    if (msgEl) { msgEl.innerText = `Deleted ${ids.length} card(s).`; msgEl.style.display = 'block'; msgEl.style.color = 'green'; }
  } else {
    // local fallback: remove exact case-insensitive matches
    const idx = flashcards.findIndex(f => (f.english || '').toLowerCase() === search.toLowerCase());
    if (idx === -1) { if (msgEl) { msgEl.innerText = 'No matching local card found.'; msgEl.style.display = 'block'; } return; }
    flashcards.splice(idx, 1);
    saveFlashcardsToLocal();
    if (flashcards.length === 0) { displayOrder = null; currentIndex = 0; displayCard(); if (msgEl) { msgEl.innerText = 'Deleted local card.'; msgEl.style.display = 'block'; msgEl.style.color = 'green'; } return; }
    // rebuild displayOrder after deletion
    regenerateDisplayOrder();
    currentIndex = Math.min(currentIndex, flashcards.length - 1);
    displayCard();
    if (msgEl) { msgEl.innerText = 'Deleted local card.'; msgEl.style.display = 'block'; msgEl.style.color = 'green'; }
  }
}


function flipCard() {
  const cardInner = document.getElementById('cardInner');
  isFlipped = !isFlipped;
  cardInner.classList.toggle('flipped', isFlipped);
}

function displayCard() {
  isFlipped = false;
  document.getElementById('cardInner').classList.remove('flipped');

  if (!flashcards || flashcards.length === 0) {
    document.getElementById('cardFront').innerText = 'Add a word to start';
    document.getElementById('cardBack').innerText = '-';
    return;
  }

  // map currentIndex (position in displayOrder) to the logical flashcards array index
  const logicalIndex = (displayOrder && Array.isArray(displayOrder) && displayOrder.length === flashcards.length)
    ? displayOrder[currentIndex]
    : currentIndex;

  const card = flashcards[logicalIndex] || flashcards[0];
  document.getElementById('cardFront').innerText = card.english;
  document.getElementById('cardBack').innerText = ensureSpanishQuestionMark(card.spanish);
}

function nextCard() {
  if (flashcards.length > 0) {
    // Ensure current card shows English (don't reveal Spanish of the next card)
    isFlipped = false;
    const cardInner = document.getElementById('cardInner');
    if (cardInner) cardInner.classList.remove('flipped');

    // Advance to next card and display its front (English)
    currentIndex = (currentIndex + 1) % flashcards.length;
    displayCard();
  }
}

function prevCard() {
  if (flashcards.length > 0) {
    // Ensure current card shows English before moving back
    isFlipped = false;
    const cardInner = document.getElementById('cardInner');
    if (cardInner) cardInner.classList.remove('flipped');

    currentIndex = (currentIndex - 1 + flashcards.length) % flashcards.length;
    displayCard();
  }
}

// MODE handling
function setMode(newMode) {
  mode = newMode;
  const modeEditBtn = document.getElementById('modeEditBtn');
  const modePracticeBtn = document.getElementById('modePracticeBtn');
  if (modeEditBtn) modeEditBtn.disabled = mode === 'edit';
  if (modePracticeBtn) modePracticeBtn.disabled = mode === 'practice';

  const editAreaEl = document.getElementById('editArea');
  const practiceAreaEl = document.getElementById('practiceArea');
  const isAdmin = Boolean(currentUser && currentUser.email && currentUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());

  if (mode === 'edit') {
    // Only allow showing edit area when admin
    if (editAreaEl) editAreaEl.style.display = isAdmin ? 'block' : 'none';
    if (practiceAreaEl) practiceAreaEl.style.display = 'none';
    displayCard();
  } else {
    // In non-edit mode, keep edit area visible for admins but hide for non-admins
    if (editAreaEl) editAreaEl.style.display = isAdmin ? 'block' : 'none';
    if (practiceAreaEl) {
      practiceAreaEl.style.display = 'block';
      startPractice();
    } else {
      // No practice UI; just show the flashcard view
      displayCard();
    }
  }
}

// PRACTICE mode functions
function startPractice() {
  if (flashcards.length === 0) {
    document.getElementById('practiceQuestion').innerText = 'No cards available. Switch to Edit Mode to add words.';
    document.getElementById('practiceAnswer').style.display = 'none';
    document.getElementById('practiceSubmitBtn').style.display = 'none';
    document.getElementById('practiceNextBtn').style.display = 'none';
    document.getElementById('practiceFeedback').innerText = '';
    document.getElementById('practiceScore').innerText = 'Score: 0 / 0';
    return;
  }

  // initialize practice order (shuffle)
  practiceOrder = flashcards.map((_, i) => i);
  for (let i = practiceOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [practiceOrder[i], practiceOrder[j]] = [practiceOrder[j], practiceOrder[i]];
  }
  practiceIndex = 0;
  practiceScore = 0;
  practiceTotal = 0;

  document.getElementById('practiceAnswer').style.display = 'inline-block';
  document.getElementById('practiceSubmitBtn').style.display = 'inline-block';
  document.getElementById('practiceNextBtn').style.display = 'none';
  document.getElementById('practiceFeedback').innerText = '';
  updatePracticeView();
}

function updatePracticeView() {
  const idx = practiceOrder[practiceIndex];
  document.getElementById('practiceQuestion').innerText = flashcards[idx].english;
  document.getElementById('practiceAnswer').value = '';
  document.getElementById('practiceAnswer').focus();
  document.getElementById('practiceScore').innerText = `Score: ${practiceScore} / ${practiceTotal}`;
  document.getElementById('practiceNextBtn').style.display = 'none';
  document.getElementById('practiceSubmitBtn').disabled = false;
}

function submitPracticeAnswer() {
  const answer = document.getElementById('practiceAnswer').value.trim();
  const idx = practiceOrder[practiceIndex];
  const correct = flashcards[idx].spanish.trim();
  practiceTotal += 1;

  if (answer.length === 0) {
    document.getElementById('practiceFeedback').innerText = 'Please enter an answer.';
    return;
  }

  if (answer.toLowerCase() === correct.toLowerCase()) {
    practiceScore += 1;
    document.getElementById('practiceFeedback').innerText = 'Correct!';
  } else {
    document.getElementById('practiceFeedback').innerText = `Incorrect — answer: ${correct}`;
  }

  document.getElementById('practiceScore').innerText = `Score: ${practiceScore} / ${practiceTotal}`;
  document.getElementById('practiceSubmitBtn').disabled = true;
  document.getElementById('practiceNextBtn').style.display = 'inline-block';
}

function nextPracticeQuestion() {
  practiceIndex += 1;
  if (practiceIndex >= practiceOrder.length) {
    document.getElementById('practiceQuestion').innerText = 'Practice complete!';
    document.getElementById('practiceAnswer').style.display = 'none';
    document.getElementById('practiceSubmitBtn').style.display = 'none';
    document.getElementById('practiceNextBtn').style.display = 'none';
    document.getElementById('practiceFeedback').innerText = `Final score: ${practiceScore} / ${practiceTotal}`;
    return;
  }
  updatePracticeView();
}

function endPractice() {
  setMode('edit');
}

// Wire up UI buttons via event listeners and expose a few helpers
function wireUi() {
  const btnSignUp = document.getElementById('btnSignUp');
  const btnSignIn = document.getElementById('btnSignIn');
  const btnSignOut = document.getElementById('btnSignOut');
  const btnSignOutTop = document.getElementById('btnSignOutTop');
  const addBtn = document.getElementById('btnAdd') || document.querySelector('.form-box button');
  const modeEdit = document.getElementById('modeEditBtn');
  const modePractice = document.getElementById('modePracticeBtn');
  const prevBtn = document.getElementById('prevBtn') || document.querySelector('.nav-box button:nth-child(1)');
  const nextBtn = document.getElementById('nextBtn') || document.querySelector('.nav-box button:nth-child(2)');

  if (btnSignUp) btnSignUp.addEventListener('click', () => { try { supabaseSignUp(); } catch(e){console.error(e);} });
  if (btnSignIn) btnSignIn.addEventListener('click', () => { try { supabaseSignIn(); } catch(e){console.error(e);} });
  if (btnSignOut) btnSignOut.addEventListener('click', () => { try { signOut(); } catch(e){console.error(e);} });
  if (btnSignOutTop) btnSignOutTop.addEventListener('click', () => { try { signOut(); } catch(e){console.error(e);} });

  // admin sign-in button exists but behavior is controlled by updateAuthUI() based on session state
  const adminIntro = document.getElementById('adminIntro');
  if (adminIntro) adminIntro.style.display = 'none'; // ensure hidden at startup
  
  if (addBtn) addBtn.addEventListener('click', () => { try { addCard(); } catch(e){console.error(e);} });
  const deleteBtn = document.getElementById('btnDelete');
  if (deleteBtn) deleteBtn.addEventListener('click', () => { try { deleteCard(); } catch(e){console.error(e);} });
  const btnDeleteByEnglish = document.getElementById('btnDeleteByEnglish');
  if (btnDeleteByEnglish) btnDeleteByEnglish.addEventListener('click', () => { try { deleteByEnglish(); } catch(e){console.error(e);} });
  if (modeEdit) modeEdit.addEventListener('click', () => setMode('edit'));
  if (modePractice) modePractice.addEventListener('click', () => setMode('practice'));
  if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); try { prevCard(); } catch(err){console.error(err);} });
  if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); try { nextCard(); } catch(err){console.error(err);} });

  // practice controls
  const submitBtn = document.getElementById('practiceSubmitBtn');
  const nextPracticeBtn = document.getElementById('practiceNextBtn');
  const endPracticeBtn = document.getElementById('practiceEndBtn');
  if (submitBtn) submitBtn.addEventListener('click', () => submitPracticeAnswer());
  if (nextPracticeBtn) nextPracticeBtn.addEventListener('click', () => nextPracticeQuestion());
  if (endPracticeBtn) endPracticeBtn.addEventListener('click', () => endPractice());

  // flashcard flip
  const card = document.querySelector('.flashcard');
  if (card) card.addEventListener('click', () => flipCard());
}

// Responsive JS tweaks for arrow buttons to bypass stubborn caching on some devices
function applyNavArrowStyles() {
  const arrows = document.querySelectorAll('.nav-arrow');
  if (!arrows || arrows.length === 0) return;
  const isSmall = window.innerWidth <= 428;
  arrows.forEach(a => {
    if (isSmall) {
      a.style.width = '52px';
      a.style.height = '52px';
      a.style.fontSize = '22px';
      a.style.left = a.classList.contains('left') ? '8px' : a.style.left;
      a.style.right = a.classList.contains('right') ? '8px' : a.style.right;
      a.style.boxShadow = '0 6px 14px rgba(10,12,20,0.10)';
      a.style.background = 'rgba(255,255,255,0.98)';
      a.style.opacity = '0.98';
    } else {
      a.style.width = '44px';
      a.style.height = '44px';
      a.style.fontSize = '20px';
      a.style.left = a.classList.contains('left') ? '12px' : a.style.left;
      a.style.right = a.classList.contains('right') ? '12px' : a.style.right;
      a.style.boxShadow = '0 10px 26px rgba(8,12,20,0.12)';
      a.style.background = 'linear-gradient(180deg, #ffffff 0%, #eef1f7 60%)';
      a.style.opacity = '1';
    }
  });
}

// call wiring after definitions
window.addEventListener('load', () => {
  try { wireUi(); } catch (e) { console.error('wireUi failed', e); }
  try { applyNavArrowStyles(); } catch(e) { /* ignore */ }
});

window.addEventListener('resize', () => {
  try { applyNavArrowStyles(); } catch(e) { /* ignore */ }
});

// Also expose some helpers for console debugging
window._app = {
  getSupabase: () => supabase,
  getUser: () => currentUser,
  getFlashcards: () => flashcards
};
