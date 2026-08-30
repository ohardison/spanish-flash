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
        if (currentUser) loadFlashcardsFromDB();
        else loadFlashcardsFromLocal();
      });

      if (currentUser) {
        updateAuthUI();
        await loadFlashcardsFromDB();
      } else {
        updateAuthUI();
        loadFlashcardsFromLocal();
      }
    } else {
      console.warn('Supabase client not available, falling back to localStorage');
      loadFlashcardsFromLocal();
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
  const userEmail = document.getElementById('userEmail');
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
    if (userEmail) userEmail.innerText = currentUser.email;
    if (containerEl) containerEl.style.display = 'block';

    // Only show edit controls (add/list/delete) to the admin account. Admin always sees the add form below flashcards.
    if (editArea) {
      editArea.style.display = isAdmin ? 'block' : 'none';
    }
    if (deleteBtn) deleteBtn.style.display = isAdmin ? 'inline-block' : 'none';
    if (addBtn) addBtn.style.display = isAdmin ? 'inline-block' : 'none';
    if (adminIntro) adminIntro.style.display = isAdmin ? 'block' : 'none';
    if (adminMsg) { adminMsg.style.display = 'none'; adminMsg.innerText = ''; adminMsg.style.color='red'; }

    // Set adminSignInBtn to act as Sign out when logged in
    if (adminSignInBtn) {
      adminSignInBtn.textContent = 'Sign out';
      adminSignInBtn.onclick = async () => {
        try {
          await signOut();
        } catch (e) { console.error('signOut failed', e); }
      };
    }

    // If a non-admin ended up in edit mode, switch them to practice for safety
    if (!isAdmin && mode === 'edit') setMode('practice');
  } else {
    // Not signed in: show flashcards landing page using localStorage fallback
    if (loginBox) loginBox.style.display = 'none';
    if (userInfo) userInfo.style.display = 'none';
    if (containerEl) containerEl.style.display = 'block';

    // Hide edit controls for anonymous users
    if (editArea) editArea.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
    if (adminIntro) adminIntro.style.display = 'none';
    if (adminMsg) { adminMsg.style.display = 'none'; adminMsg.innerText = ''; }

    // Set adminSignInBtn to open login box when not signed in
    if (adminSignInBtn) {
      adminSignInBtn.textContent = 'Admin sign in';
      adminSignInBtn.onclick = () => {
        const loginBoxEl = document.getElementById('loginBox');
        if (!loginBoxEl) return;
        loginBoxEl.style.display = loginBoxEl.style.display === 'block' ? 'none' : 'block';
      };
    }

    // Ensure anonymous users land in practice mode
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
  if (!supabase) return; await supabase.auth.signOut(); currentUser = null; updateAuthUI(); loadFlashcardsFromLocal(); }

// LocalStorage fallback
function loadFlashcardsFromLocal() {
  flashcards = JSON.parse(localStorage.getItem('myFlashcards')) || [];
  currentIndex = 0;
  displayCard();
}

function saveFlashcardsToLocal() { localStorage.setItem('myFlashcards', JSON.stringify(flashcards)); }

// Supabase DB functions
async function loadFlashcardsFromDB() {
  if (!supabase || !currentUser) { loadFlashcardsFromLocal(); return; }
  const { data, error } = await supabase
    .from('flashcards')
    .select('id, english, spanish, created_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });
  if (error) { console.error('load error', error); loadFlashcardsFromLocal(); return; }
  flashcards = data.map(r => ({ id: r.id, english: r.english, spanish: r.spanish }));
  currentIndex = 0;
  displayCard();
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
  currentIndex = flashcards.length - 1;
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
    flashcards.splice(currentIndex, 1);
  } else {
    // local fallback
    flashcards.splice(currentIndex, 1);
    saveFlashcardsToLocal();
  }

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

  if (flashcards.length === 0) {
    document.getElementById('cardFront').innerText = 'Add a word to start';
    document.getElementById('cardBack').innerText = '-';
    return;
  }

  document.getElementById('cardFront').innerText = flashcards[currentIndex].english;
  document.getElementById('cardBack').innerText = flashcards[currentIndex].spanish;
}

function nextCard() {
  if (flashcards.length > 0) {
    currentIndex = (currentIndex + 1) % flashcards.length;
    displayCard();
  }
}

function prevCard() {
  if (flashcards.length > 0) {
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
  const addBtn = document.getElementById('btnAdd') || document.querySelector('.form-box button');
  const modeEdit = document.getElementById('modeEditBtn');
  const modePractice = document.getElementById('modePracticeBtn');
  const prevBtn = document.getElementById('prevBtn') || document.querySelector('.nav-box button:nth-child(1)');
  const nextBtn = document.getElementById('nextBtn') || document.querySelector('.nav-box button:nth-child(2)');

  if (btnSignUp) btnSignUp.addEventListener('click', () => { try { supabaseSignUp(); } catch(e){console.error(e);} });
  if (btnSignIn) btnSignIn.addEventListener('click', () => { try { supabaseSignIn(); } catch(e){console.error(e);} });
  if (btnSignOut) btnSignOut.addEventListener('click', () => { try { signOut(); } catch(e){console.error(e);} });

  // admin sign-in button exists but behavior is controlled by updateAuthUI() based on session state
  const adminSignInBtn = document.getElementById('adminSignInBtn');
  const adminIntro = document.getElementById('adminIntro');
  if (adminIntro) adminIntro.style.display = 'none'; // ensure hidden at startup
  // Do not bind click here; updateAuthUI will set the button text and handler depending on auth state
  
  if (addBtn) addBtn.addEventListener('click', () => { try { addCard(); } catch(e){console.error(e);} });
  const deleteBtn = document.getElementById('btnDelete');
  if (deleteBtn) deleteBtn.addEventListener('click', () => { try { deleteCard(); } catch(e){console.error(e);} });
  const btnDeleteByEnglish = document.getElementById('btnDeleteByEnglish');
  if (btnDeleteByEnglish) btnDeleteByEnglish.addEventListener('click', () => { try { deleteByEnglish(); } catch(e){console.error(e);} });
  if (modeEdit) modeEdit.addEventListener('click', () => setMode('edit'));
  if (modePractice) modePractice.addEventListener('click', () => setMode('practice'));
  if (prevBtn) prevBtn.addEventListener('click', () => prevCard());
  if (nextBtn) nextBtn.addEventListener('click', () => nextCard());

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

// call wiring after definitions
window.addEventListener('load', () => {
  try { wireUi(); } catch (e) { console.error('wireUi failed', e); }
});

// Also expose some helpers for console debugging
window._app = {
  getSupabase: () => supabase,
  getUser: () => currentUser,
  getFlashcards: () => flashcards
};
