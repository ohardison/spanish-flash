// Load saved flashcards from local storage, or start empty
let flashcards = JSON.parse(localStorage.getItem('myFlashcards')) || [];
let currentIndex = 0;
let isFlipped = false;

// Display the first card immediately when the page opens
window.onload = function() {
  displayCard();
};

function addCard() {
  const english = document.getElementById('englishInput').value.trim();
  const spanish = document.getElementById('spanishInput').value.trim();

  if (english && spanish) {
    flashcards.push({ english, spanish });

    // Save updated list to local storage
    localStorage.setItem('myFlashcards', JSON.stringify(flashcards));

    document.getElementById('englishInput').value = '';
    document.getElementById('spanishInput').value = '';
    currentIndex = flashcards.length - 1;
    displayCard();
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
