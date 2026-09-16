// Gemeinsame Logik für freeplay.html und tournament.html: Tischliste des jeweiligen Modus
// (Beitreten/Erstellen) und, sobald man an einem Tisch sitzt, die Sitzansicht (wer ist schon
// da) mit "Tisch verlassen" - danach geht's zurück zu menu.html. Erwartet folgende IDs im
// Dokument: greeting, logout-btn, error, room-panel, room-name, room-status, room-seats,
// leave-room, browse-panel, create-table, table-list.
import { ensureSignedIn, getProfile, logout } from './auth.js';
import { watchOpenGames, createTable, joinTable, leaveTable, watchGame, watchMySeat, SEAT_LABELS } from './lobby.js';

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
  let latestGame = null;
  let latestSeat = null;

  const roomPanel = document.getElementById('room-panel');
  const browsePanel = document.getElementById('browse-panel');
  const roomStatus = document.getElementById('room-status');
  const roomSeats = document.getElementById('room-seats');

  function rememberSeat(gameId, seatIndex) {
    mine = { gameId, seatIndex };
    localStorage.setItem('tichu.mySeat', JSON.stringify(mine));
  }

  function renderRoom() {
    if (!mine || !latestGame) {
      roomPanel.hidden = true;
      browsePanel.hidden = false;
      return;
    }
    roomPanel.hidden = false;
    browsePanel.hidden = true;
    document.getElementById('room-name').textContent = latestGame.name ? `Tisch ${latestGame.name}` : 'Dein Tisch';
    const labels = { waiting: 'Warte auf Mitspieler…', dealt: 'Karten ausgeteilt - Spielansicht folgt.', playing: 'Spiel läuft.', finished: 'Spiel beendet.' };
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
  }

  function attachToTable(gameId, seatIndex) {
    rememberSeat(gameId, seatIndex);
    unsubActiveGame = watchGame(gameId, (game) => { latestGame = game; renderRoom(); });
    unsubActiveSeat = watchMySeat(gameId, seatIndex, (seat) => { latestSeat = seat; renderRoom(); });
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

  createTableBtn.addEventListener('click', async () => {
    try {
      const gameId = await createTable(mode, 1000);
      const { seatIndex } = await joinTable(gameId, user.uid);
      attachToTable(gameId, seatIndex);
    } catch (e) {
      showError(e);
    }
  });
}
