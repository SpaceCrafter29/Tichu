// Gemeinsame Logik für freeplay.html und tournament.html: Tischliste des jeweiligen Modus
// (Beitreten/Erstellen) und, sobald man an einem Tisch sitzt, die Sitzansicht (wer ist schon
// da) mit "Tisch verlassen" - danach geht's zurück zu menu.html. Erwartet folgende IDs im
// Dokument: greeting, logout-btn, error, room-panel, room-name, room-status, room-seats,
// leave-room, browse-panel, create-table, table-list.
import { ensureSignedIn, getProfile, logout } from './auth.js';
import {
  watchOpenGames, createTable, joinTable, leaveTable, watchGame, watchMySeat, SEAT_LABELS,
  SEAT_DOC_IDS, randomTableName, TARGET_MIN, TARGET_MAX, heartbeat, watchAllSeats,
} from './lobby.js';

// Solange ein Tisch noch wartet (Lobby-Phase), meldet man sich alle 20s bei den eigenen
// Mitsitzenden - wer 90s (also ~4 verpasste Heartbeats) nichts mehr von sich hören lässt, gilt
// als inaktiv und wird von einem der wartenden Mitspieler automatisch rausgeworfen (siehe
// checkStaleSeats() unten und die isStaleSeatCleared()-Ausnahme in firestore.rules). Analog zum
// Zugtimer im laufenden Spiel (siehe board.html), nur für die Wartephase davor.
const LOBBY_HEARTBEAT_MS = 20 * 1000;
const LOBBY_STALE_MS = 90 * 1000;

export async function mountRoomPage(mode) {
  const errorEl = document.getElementById('error');
  function showError(e) {
    console.error(e);
    errorEl.textContent = e && e.message ? e.message : String(e);
    errorEl.hidden = false;
  }

  const user = await ensureSignedIn().catch((e) => { showError(e); return null; });
  if (!user) { window.location.href = 'index.html'; throw new Error('nicht angemeldet'); }

  const profile = await getProfile(user.uid);
  if (!profile || !profile.displayName) {
    window.location.href = 'index.html';
    throw new Error('kein Profil');
  }
  document.getElementById('greeting').textContent = `Angemeldet als ${profile.displayName}.`;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
  });

  let mine = JSON.parse(localStorage.getItem('tichu.mySeat') || 'null');
  let unsubActiveGame = null;
  let unsubActiveSeat = null;
  let unsubAllSeats = null;
  let lobbyTimer = null;
  let latestGame = null;
  let latestSeat = null;
  let latestAllSeats = {};

  // Wirft Mitsitzende raus, die seit LOBBY_STALE_MS keinen Heartbeat mehr geschickt haben -
  // nur solange der Tisch noch wartet (danach übernimmt der Zugtimer in board.html).
  function checkStaleSeats() {
    if (!mine || !latestGame || latestGame.status !== 'waiting') return;
    for (let i = 0; i < 4; i++) {
      if (i === mine.seatIndex || latestGame.seats[i] == null) continue;
      const seatData = latestAllSeats[SEAT_DOC_IDS[i]];
      const lastActive = seatData && seatData.lastActive;
      if (!lastActive || typeof lastActive.toMillis !== 'function') continue;
      if (Date.now() - lastActive.toMillis() > LOBBY_STALE_MS) {
        leaveTable(mine.gameId, i).catch(() => {}); // mehrere Mitspieler können das gleichzeitig
        // versuchen - der zweite Versuch findet den Sitz dann einfach schon leer vor (no-op).
      }
    }
  }

  function lobbyTick() {
    if (!mine || !latestGame || latestGame.status !== 'waiting') return;
    heartbeat(mine.gameId, mine.seatIndex).catch(() => {});
    checkStaleSeats();
  }

  const roomPanel = document.getElementById('room-panel');
  const browsePanel = document.getElementById('browse-panel');
  const roomStatus = document.getElementById('room-status');
  const roomSeats = document.getElementById('room-seats');

  // Eigener Konfigurations-Screen fürs Tisch-Erstellen (Name schon vergeben, Zielpunktzahl +
  // Comeback-Regel einstellbar) - wird dynamisch eingefügt, damit freeplay.html/tournament.html
  // dafür keine eigene Extra-Struktur brauchen.
  const createPanel = document.createElement('div');
  createPanel.className = 'panel';
  createPanel.hidden = true;
  browsePanel.parentNode.insertBefore(createPanel, browsePanel);
  let creating = false;
  let pendingName = '';

  function renderCreatePanel() {
    createPanel.innerHTML = '';
    const title = document.createElement('h3');
    title.style.margin = '0 0 4px';
    title.textContent = `Tisch ${pendingName}`;
    createPanel.appendChild(title);

    const targetLabel = document.createElement('label');
    targetLabel.style.display = 'block';
    targetLabel.style.marginTop = '10px';
    targetLabel.textContent = `Zielpunktzahl (${TARGET_MIN}-${TARGET_MAX}, in 100er-Schritten - mindestens 1 Runde)`;
    createPanel.appendChild(targetLabel);
    const targetInput = document.createElement('input');
    targetInput.type = 'number';
    targetInput.min = String(TARGET_MIN);
    targetInput.max = String(TARGET_MAX);
    targetInput.step = '100';
    targetInput.value = '1000';
    createPanel.appendChild(targetInput);

    const catchUpLabel = document.createElement('label');
    catchUpLabel.style.display = 'flex';
    catchUpLabel.style.alignItems = 'center';
    catchUpLabel.style.gap = '8px';
    catchUpLabel.style.marginTop = '12px';
    const catchUpCheckbox = document.createElement('input');
    catchUpCheckbox.type = 'checkbox';
    catchUpCheckbox.checked = true;
    catchUpLabel.appendChild(catchUpCheckbox);
    catchUpLabel.append('Erinnerung: Tichu ansagen, sobald ein Team nur noch 100 Punkte vom Ziel entfernt ist');
    createPanel.appendChild(catchUpLabel);

    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginTop = '16px';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Tisch erstellen';
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try {
        const target = Math.min(TARGET_MAX, Math.max(TARGET_MIN, Number(targetInput.value) || 1000));
        const gameId = await createTable(mode, { name: pendingName, target, catchUpRule: catchUpCheckbox.checked });
        const { seatIndex } = await joinTable(gameId, user.uid);
        creating = false;
        attachToTable(gameId, seatIndex);
      } catch (e) {
        showError(e);
        confirmBtn.disabled = false;
      }
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'secondary';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.addEventListener('click', () => { creating = false; renderRoom(); });
    row.appendChild(confirmBtn);
    row.appendChild(cancelBtn);
    createPanel.appendChild(row);
  }

  function rememberSeat(gameId, seatIndex) {
    mine = { gameId, seatIndex };
    localStorage.setItem('tichu.mySeat', JSON.stringify(mine));
  }

  function renderRoom() {
    if (!mine || !latestGame) {
      roomPanel.hidden = true;
      if (creating) {
        browsePanel.hidden = true;
        createPanel.hidden = false;
        renderCreatePanel();
      } else {
        browsePanel.hidden = false;
        createPanel.hidden = true;
      }
      return;
    }
    roomPanel.hidden = false;
    browsePanel.hidden = true;
    createPanel.hidden = true;
    document.getElementById('room-name').textContent = latestGame.name ? `Tisch ${latestGame.name}` : 'Dein Tisch';
    const labels = { waiting: 'Warte auf Mitspieler…', dealt: 'Karten ausgeteilt.', playing: 'Spiel läuft.', finished: 'Spiel beendet.' };
    let text = labels[latestGame.status] || latestGame.status;
    if (latestSeat && latestSeat.hand) text += ` Deine Hand: ${latestSeat.hand.length} Karten.`;
    roomStatus.textContent = text;
    roomSeats.innerHTML = '';
    latestGame.seats.forEach((token, i) => {
      const chip = document.createElement('div');
      chip.className = 'seat-chip' + (token ? ' filled' : '') + (i === mine.seatIndex ? ' me' : '');
      chip.textContent = SEAT_LABELS[i] + (token ? (i === mine.seatIndex ? ' (du)' : ' - beigetreten') : ' - frei');
      roomSeats.appendChild(chip);
    });

    let openBoardBtn = document.getElementById('open-board-btn');
    if (latestGame.status !== 'waiting') {
      if (!openBoardBtn) {
        openBoardBtn = document.createElement('button');
        openBoardBtn.id = 'open-board-btn';
        openBoardBtn.style.marginTop = '10px';
        roomPanel.appendChild(openBoardBtn);
      }
      openBoardBtn.textContent = 'Zum Spielbrett';
      openBoardBtn.onclick = () => { window.location.href = `board.html?g=${mine.gameId}`; };
    } else if (openBoardBtn) {
      openBoardBtn.remove();
    }
  }

  function attachToTable(gameId, seatIndex) {
    rememberSeat(gameId, seatIndex);
    unsubActiveGame = watchGame(gameId, (game) => { latestGame = game; renderRoom(); checkStaleSeats(); });
    unsubActiveSeat = watchMySeat(gameId, seatIndex, (seat) => { latestSeat = seat; renderRoom(); });
    unsubAllSeats = watchAllSeats(gameId, (seats) => { latestAllSeats = seats; checkStaleSeats(); });
    if (!lobbyTimer) lobbyTimer = setInterval(lobbyTick, LOBBY_HEARTBEAT_MS);
  }

  if (mine) attachToTable(mine.gameId, mine.seatIndex);
  renderRoom();

  document.getElementById('leave-room').addEventListener('click', async () => {
    if (!mine) return;
    const { gameId, seatIndex } = mine;
    try {
      await leaveTable(gameId, seatIndex);
      mine = null;
      latestGame = null;
      latestSeat = null;
      localStorage.removeItem('tichu.mySeat');
      if (unsubActiveGame) { unsubActiveGame(); unsubActiveGame = null; }
      if (unsubActiveSeat) { unsubActiveSeat(); unsubActiveSeat = null; }
      if (unsubAllSeats) { unsubAllSeats(); unsubAllSeats = null; }
      if (lobbyTimer) { clearInterval(lobbyTimer); lobbyTimer = null; }
      window.location.href = 'menu.html';
    } catch (e) {
      showError(e);
    }
  });

  const tableListEl = document.getElementById('table-list');
  const createTableBtn = document.getElementById('create-table');

  function renderTableList(games) {
    if (games.length === 0) {
      tableListEl.innerHTML = '<p class="muted">Aktuell keine offenen Tische.</p>';
      return;
    }
    tableListEl.innerHTML = '';
    for (const game of games) {
      const openSeats = game.seats.filter((s) => s === null).length;
      const row = document.createElement('div');
      row.className = 'table-row';
      const tableName = game.name || `Tisch ${game.id.slice(0, 6)}`;
      row.innerHTML = `
        <span>${tableName} <span class="muted">(${4 - openSeats}/4, Ziel ${game.target})</span></span>
      `;
      const btn = document.createElement('button');
      btn.textContent = 'Beitreten';
      btn.className = 'secondary';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const { seatIndex } = await joinTable(game.id, user.uid);
          attachToTable(game.id, seatIndex);
        } catch (e) {
          showError(e);
          btn.disabled = false;
        }
      });
      row.appendChild(btn);
      tableListEl.appendChild(row);
    }
  }

  watchOpenGames(mode, renderTableList);

  createTableBtn.addEventListener('click', () => {
    creating = true;
    pendingName = randomTableName();
    renderRoom();
  });
}
