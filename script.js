// Use Supabase for auth and storage. If Supabase isn't configured, app falls back to localStorage for flashcards.
let supabase = null;
let currentUser = null;

let flashcards = [];
let currentIndex = 0;
let isFlipped = false;

// Mode & practice state
let mode = 'edit'; // 'edit' or 'practice'
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

  if (currentUser) {
    loginBox.style.display = 'none';
    userInfo.style.display = 'block';
    userEmail.innerText = currentUser.email;
    document.querySelector('.container').style.display = 'block';
  } else {
    loginBox.style.display = 'block';
    userInfo.style.display = 'none';
    document.querySelector('.container').style.display = 'none';
  }
}

async function supabaseSignUp() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  msg.style.display = 'none';

  if (!supabase) { msg.innerText = 'Server not configured for Supabase.'; msg.style.display = 'block'; return; }
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
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { msg.innerText = error.message; msg.style.display = 'block'; }
  else { currentUser = data.user; updateAuthUI(); await loadFlashcardsFromDB(); }
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
  document.getElementById('modeEditBtn').disabled = mode === 'edit';
  document.getElementById('modePracticeBtn').disabled = mode === 'practice';

  if (mode === 'edit') {
    document.getElementById('editArea').style.display = 'block';
    document.getElementById('practiceArea').style.display = 'none';
    displayCard();
  } else {
    document.getElementById('editArea').style.display = 'none';
    document.getElementById('practiceArea').style.display = 'block';
    startPractice();
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
  if (addBtn) addBtn.addEventListener('click', () => { try { addCard(); } catch(e){console.error(e);} });
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
