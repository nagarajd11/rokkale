/**
 * TabMate — Friends Money & Lending Ledger
 * Multi-friend Room Management, Strict Lender-Only Settlement Verification, Real-Time Sync
 */

(function () {
  'use strict';

  // ==========================================
  // 1. CONSTANTS & STORAGE KEYS
  // ==========================================
  const STORAGE_ROOMS = 'tabmate_v3_rooms';
  const STORAGE_ACTIVE_ROOM_ID = 'tabmate_v3_active_room_id';
  const STORAGE_ACTIVE_USER_ID = 'tabmate_v3_active_user_id';
  const STORAGE_THEME = 'tabmate_v3_theme';

  const syncChannel = (typeof window !== 'undefined' && 'BroadcastChannel' in window)
    ? new BroadcastChannel('tabmate_friends_sync')
    : null;

  // Realistic Initial Friends Room
  const DEFAULT_INITIAL_ROOM = {
    id: 'ROOM-9142',
    name: 'Apartment Friends Ledger',
    category: 'Shared Expenses',
    members: [
      { id: 'm_rahul', name: 'Rahul', upi: 'rahul@okhdfcbank', phone: '+91 98765 11111', color: '#10b981' },
      { id: 'm_aryan', name: 'Aryan', upi: 'aryan@paytm', phone: '+91 98765 22222', color: '#3b82f6' },
      { id: 'm_vikram', name: 'Vikram', upi: 'vikram@upi', phone: '+91 98765 33333', color: '#8b5cf6' },
      { id: 'm_sneha', name: 'Sneha', upi: 'sneha@oksbi', phone: '+91 98765 44444', color: '#ec4899' }
    ],
    transactions: [
      {
        id: 'tx_101',
        lenderId: 'm_rahul',   // Rahul lent
        borrowerId: 'm_aryan', // Aryan owes
        amount: 650,
        description: 'Swiggy Dinner Order 🍕',
        status: 'active', // 'active' | 'awaiting_confirmation' | 'settled'
        createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
        settledAt: null,
        settledBy: null,
        method: '',
        note: ''
      },
      {
        id: 'tx_102',
        lenderId: 'm_vikram',  // Vikram lent
        borrowerId: 'm_rahul', // Rahul owes
        amount: 400,
        description: 'Cab to Airport 🚗',
        status: 'awaiting_confirmation', // Rahul sent payment notification, Vikram needs to verify!
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        settledAt: null,
        settledBy: null,
        method: 'UPI',
        note: 'Rahul reported payment sent via GPay'
      },
      {
        id: 'tx_103',
        lenderId: 'm_rahul',   // Rahul lent
        borrowerId: 'm_sneha', // Sneha owes
        amount: 300,
        description: 'Concert Passes 🎟️',
        status: 'settled',
        createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        settledAt: new Date(Date.now() - 3600000 * 6).toISOString(),
        settledBy: 'm_rahul', // Verified by Rahul (Lender)
        method: 'UPI (GPay / PhonePe / Paytm)',
        note: 'Payment verified and settled'
      },
      {
        id: 'tx_104',
        lenderId: 'm_aryan',   // Aryan lent
        borrowerId: 'm_sneha', // Sneha owes
        amount: 250,
        description: 'Supermarket Groceries 🛒',
        status: 'active',
        createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
        settledAt: null,
        settledBy: null,
        method: '',
        note: ''
      }
    ],
    createdAt: new Date().toISOString()
  };

  // State
  let rooms = [];
  let currentRoom = null;
  let activeMemberId = null;
  let activeFilter = 'all';
  let activeFriendColor = '#10b981';

  // ==========================================
  // 2. AUDIO SYNTHESIZER
  // ==========================================
  const audioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
    ? new (window.AudioContext || window.webkitAudioContext)()
    : null;

  function playSound(type) {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;

      if (type === 'record') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(740, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'settle') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.08);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'notify') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(900, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {
      // Audio fails gracefully
    }
  }

  // ==========================================
  // ==========================================
  // 3. PERSISTENCE & REAL-TIME SERVER SYNC
  // ==========================================
  const API_BASE = (window.location.protocol.startsWith('http') && window.location.origin)
    ? window.location.origin
    : 'http://10.94.78.121:8080';

  let pollTimer = null;

  async function apiCall(endpoint, method = 'GET', data = null) {
    try {
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (data && method !== 'GET') {
        opts.body = JSON.stringify(data);
      }
      const res = await fetch(`${API_BASE}${endpoint}`, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.warn(`[RokkaLE Server] ${endpoint} fetch issue:`, e.message || e);
      return null;
    }
  }

  function getShareLink(roomId) {
    const targetId = roomId || (currentRoom ? currentRoom.id : 'ROOM-9142');
    const base = window.location.protocol.startsWith('http')
      ? `${window.location.origin}${window.location.pathname}`
      : `http://10.94.78.121:8080/`;
    return `${base}?room=${encodeURIComponent(targetId)}`;
  }

  async function loadData() {
    // Theme
    const savedTheme = localStorage.getItem(STORAGE_THEME) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Initial local cache recovery
    const savedRoomsStr = localStorage.getItem(STORAGE_ROOMS);
    if (savedRoomsStr) {
      try {
        rooms = JSON.parse(savedRoomsStr);
      } catch (e) {
        rooms = [JSON.parse(JSON.stringify(DEFAULT_INITIAL_ROOM))];
      }
    } else {
      rooms = [JSON.parse(JSON.stringify(DEFAULT_INITIAL_ROOM))];
    }

    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    const userFromUrl = urlParams.get('user');

    // Fetch master rooms list from server in parallel
    const serverRooms = await apiCall('/api/rooms');
    if (Array.isArray(serverRooms) && serverRooms.length > 0) {
      // Merge server rooms into local
      serverRooms.forEach(sr => {
        const idx = rooms.findIndex(r => r.id === sr.id);
        if (idx >= 0) rooms[idx] = sr;
        else rooms.push(sr);
      });
      localStorage.setItem(STORAGE_ROOMS, JSON.stringify(rooms));
    }

    // Determine target room
    const targetRoomId = roomFromUrl || localStorage.getItem(STORAGE_ACTIVE_ROOM_ID);
    let matched = rooms.find(r => r.id === targetRoomId);

    // If requested room not in cache, try fetching directly from server
    if (!matched && roomFromUrl) {
      const fetched = await apiCall(`/api/rooms?id=${encodeURIComponent(roomFromUrl)}`);
      if (fetched && !fetched.error) {
        rooms.unshift(fetched);
        matched = fetched;
        localStorage.setItem(STORAGE_ROOMS, JSON.stringify(rooms));
      }
    }

    currentRoom = matched || rooms[0];
    localStorage.setItem(STORAGE_ACTIVE_ROOM_ID, currentRoom.id);

    // Determine active member
    if (userFromUrl && currentRoom.members.some(m => m.id === userFromUrl)) {
      activeMemberId = userFromUrl;
    } else {
      const savedUser = localStorage.getItem(STORAGE_ACTIVE_USER_ID);
      if (savedUser && currentRoom.members.some(m => m.id === savedUser)) {
        activeMemberId = savedUser;
      } else {
        // If arrived via invite link on a new device, prompt to choose or enter identity
        activeMemberId = currentRoom.members[0].id;
        if (roomFromUrl && currentRoom.members.length > 1) {
          setTimeout(() => openWelcomeModal(currentRoom), 400);
        }
      }
    }
    localStorage.setItem(STORAGE_ACTIVE_USER_ID, activeMemberId);

    // Broadcast sync for same-browser tabs
    if (syncChannel) {
      syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'DATA_UPDATED') {
          reloadFromStorage();
          showToast('⚡ Synchronized across devices', 'info');
        }
      };
    }

    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_ROOMS) reloadFromStorage();
    });

    // Start background live polling (syncs across different friends' phones)
    startLivePolling();
  }

  function startLivePolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!currentRoom) return;
      const latestRoom = await apiCall(`/api/rooms?id=${encodeURIComponent(currentRoom.id)}`);
      if (latestRoom && !latestRoom.error) {
        const currentTxCount = currentRoom.transactions.length;
        const latestTxCount = latestRoom.transactions.length;
        const currentMemCount = currentRoom.members.length;
        const latestMemCount = latestRoom.members.length;
        const currentTxStatusSum = currentRoom.transactions.map(t => t.id + t.status).join(',');
        const latestTxStatusSum = latestRoom.transactions.map(t => t.id + t.status).join(',');

        if (currentTxCount !== latestTxCount || currentMemCount !== latestMemCount || currentTxStatusSum !== latestTxStatusSum) {
          console.log('[RokkaLE Sync] Server has newer data, updating room view...');
          currentRoom = latestRoom;
          const idx = rooms.findIndex(r => r.id === latestRoom.id);
          if (idx >= 0) rooms[idx] = latestRoom;
          else rooms.push(latestRoom);

          localStorage.setItem(STORAGE_ROOMS, JSON.stringify(rooms));
          renderAll();
        }
      }
    }, 2800);
  }

  function reloadFromStorage() {
    const savedRoomsStr = localStorage.getItem(STORAGE_ROOMS);
    if (savedRoomsStr) {
      rooms = JSON.parse(savedRoomsStr);
      const activeRoomId = localStorage.getItem(STORAGE_ACTIVE_ROOM_ID);
      currentRoom = rooms.find(r => r.id === activeRoomId) || rooms[0];
      renderAll();
    }
  }

  function saveRooms(notifySync = true) {
    localStorage.setItem(STORAGE_ROOMS, JSON.stringify(rooms));
    if (notifySync && syncChannel && currentRoom) {
      syncChannel.postMessage({ type: 'DATA_UPDATED', roomId: currentRoom.id });
    }
  }

  // ==========================================
  // 4. BALANCES & CALCULATIONS
  // ==========================================
  function formatRupees(amount) {
    const num = Math.round(Math.abs(amount));
    return '₹' + num.toLocaleString('en-IN');
  }

  function getMember(id) {
    return currentRoom.members.find(m => m.id === id) || { id, name: 'Unknown', color: '#6366f1' };
  }

  /**
   * Calculates personal standing for the currently active member:
   * - Total Owed To You (Active transactions where you are the lender)
   * - Total You Owe (Active transactions where you are the borrower)
   * - Net Standing (Owed - Owe)
   */
  function calculateMyStanding() {
    let owedToMe = 0;
    let youOwe = 0;

    currentRoom.transactions.forEach(t => {
      if (t.status === 'settled') return; // Settled transactions don't affect pending balance
      const amt = Number(t.amount) || 0;

      if (t.lenderId === activeMemberId) {
        owedToMe += amt;
      } else if (t.borrowerId === activeMemberId) {
        youOwe += amt;
      }
    });

    const net = owedToMe - youOwe;
    return {
      owedToMe: Math.round(owedToMe),
      youOwe: Math.round(youOwe),
      net: Math.round(net)
    };
  }

  /**
   * Calculates pairwise net balance between the active user and each other member:
   * Balance > 0: Other friend owes You
   * Balance < 0: You owe other friend
   * Balance === 0: Settled
   */
  function calculatePeerBalance(otherMemberId) {
    let balance = 0;
    let activeTxCount = 0;

    currentRoom.transactions.forEach(t => {
      if (t.status === 'settled') return;
      const amt = Number(t.amount) || 0;

      if (t.lenderId === activeMemberId && t.borrowerId === otherMemberId) {
        balance += amt; // they owe you
        activeTxCount++;
      } else if (t.lenderId === otherMemberId && t.borrowerId === activeMemberId) {
        balance -= amt; // you owe them
        activeTxCount++;
      }
    });

    return {
      balance: Math.round(balance),
      activeTxCount
    };
  }

  // ==========================================
  // 5. RENDERING ENGINE
  // ==========================================
  function renderAll() {
    if (!currentRoom) return;

    renderHeader();
    renderRoomHero();
    renderStandingCards();
    populateFormSelects();
    renderPeerBalances();
    renderTransactionsTimeline();
    renderSavedRooms();
  }

  function renderHeader() {
    document.getElementById('roomCodeDisplay').textContent = currentRoom.id;

    // Active User Dropdown
    const userSelect = document.getElementById('activeUserSelect');
    userSelect.innerHTML = currentRoom.members.map(m => {
      return `<option value="${m.id}" ${m.id === activeMemberId ? 'selected' : ''}>${escapeHTML(m.name)}</option>`;
    }).join('');
  }

  function renderRoomHero() {
    document.getElementById('roomTitleDisplay').textContent = currentRoom.name;
    document.getElementById('roomCategoryBadge').textContent = currentRoom.category || 'Private Room';
    document.getElementById('memberCountLabel').textContent = currentRoom.members.length;
    const heroCode = document.getElementById('roomCodeBadgeHero');
    if (heroCode) heroCode.textContent = currentRoom.id;

    // Avatar stack
    const avatarStack = document.getElementById('membersAvatarStack');
    avatarStack.innerHTML = currentRoom.members.map(m => {
      const isMe = m.id === activeMemberId;
      return `
        <div class="stack-avatar" style="background: ${m.color || '#6366f1'}; ${isMe ? 'box-shadow: 0 0 0 2px #fff;' : ''}" title="${escapeHTML(m.name)}${isMe ? ' (You)' : ''}">
          ${m.name.charAt(0).toUpperCase()}
        </div>
      `;
    }).join('');
  }

  function renderStandingCards() {
    const { owedToMe, youOwe, net } = calculateMyStanding();

    document.getElementById('myOwedToMeAmount').textContent = formatRupees(owedToMe);
    document.getElementById('myYouOweAmount').textContent = formatRupees(youOwe);

    const netAmountEl = document.getElementById('myNetStandingAmount');
    const netSubEl = document.getElementById('myNetStandingSub');
    const netCard = document.getElementById('myNetStandingCard');

    netAmountEl.textContent = (net < 0 ? '-' : '') + formatRupees(net);

    if (net > 0) {
      netAmountEl.className = 'standing-amount text-green';
      netSubEl.textContent = 'Overall in the green (friends owe you)';
    } else if (net < 0) {
      netAmountEl.className = 'standing-amount text-red';
      netSubEl.textContent = 'Overall in the red (you owe friends)';
    } else {
      netAmountEl.className = 'standing-amount';
      netSubEl.textContent = 'All square! No outstanding debts';
    }
  }

  function populateFormSelects() {
    const lenderSelect = document.getElementById('lenderSelect');
    const borrowerSelect = document.getElementById('borrowerSelect');

    const prevLender = lenderSelect.value || activeMemberId;
    const prevBorrower = borrowerSelect.value;

    lenderSelect.innerHTML = currentRoom.members.map(m => {
      return `<option value="${m.id}">${escapeHTML(m.name)}${m.id === activeMemberId ? ' (You)' : ''}</option>`;
    }).join('');

    borrowerSelect.innerHTML = currentRoom.members.map(m => {
      return `<option value="${m.id}">${escapeHTML(m.name)}${m.id === activeMemberId ? ' (You)' : ''}</option>`;
    }).join('');

    lenderSelect.value = prevLender;
    if (prevBorrower && prevBorrower !== prevLender) {
      borrowerSelect.value = prevBorrower;
    } else {
      // Pick a different member by default
      const other = currentRoom.members.find(m => m.id !== prevLender);
      if (other) borrowerSelect.value = other.id;
    }
  }

  function renderPeerBalances() {
    const grid = document.getElementById('balancesCardsGrid');
    if (!grid) return;

    const otherMembers = currentRoom.members.filter(m => m.id !== activeMemberId);

    grid.innerHTML = otherMembers.map(m => {
      const { balance, activeTxCount } = calculatePeerBalance(m.id);
      let statusLabel = 'All Square';
      let amountFormatted = '₹0';
      let amountClass = '';

      if (balance > 0) {
        statusLabel = `${m.name} owes you`;
        amountFormatted = '+' + formatRupees(balance);
        amountClass = 'text-green';
      } else if (balance < 0) {
        statusLabel = `You owe ${m.name}`;
        amountFormatted = '-' + formatRupees(balance);
        amountClass = 'text-red';
      }

      return `
        <div class="peer-balance-card">
          <div class="peer-top">
            <div class="peer-avatar" style="background: ${m.color || '#6366f1'};">
              ${m.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div class="peer-name">${escapeHTML(m.name)}</div>
              <div class="peer-upi">${m.upi ? escapeHTML(m.upi) : 'No UPI handle'}</div>
            </div>
          </div>

          <div class="peer-standing-box">
            <span class="peer-status-label">${statusLabel}</span>
            <span class="peer-amount-value ${amountClass}">${amountFormatted}</span>
          </div>

          <div class="text-subtle" style="font-size: 0.74rem;">
            ${activeTxCount} active pending ${activeTxCount === 1 ? 'record' : 'records'}
          </div>
        </div>
      `;
    }).join('');
  }

  // ==========================================
  // 6. TRANSACTIONS TIMELINE & LENDER SETTLEMENT
  // ==========================================
  function renderTransactionsTimeline() {
    const list = document.getElementById('txTimelineList');
    const emptyState = document.getElementById('emptyTimeline');
    if (!list) return;

    const searchTerm = (document.getElementById('txSearchInput')?.value || '').toLowerCase().trim();

    // Sort descending by creation date
    const sorted = [...currentRoom.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const filtered = sorted.filter(t => {
      if (activeFilter === 'unsettled' && t.status !== 'active') return false;
      if (activeFilter === 'awaiting' && t.status !== 'awaiting_confirmation') return false;
      if (activeFilter === 'settled' && t.status !== 'settled') return false;

      if (searchTerm) {
        const lender = getMember(t.lenderId);
        const borrower = getMember(t.borrowerId);
        const matchDesc = (t.description || '').toLowerCase().includes(searchTerm);
        const matchAmt = (t.amount || '').toString().includes(searchTerm);
        const matchNames = lender.name.toLowerCase().includes(searchTerm) || borrower.name.toLowerCase().includes(searchTerm);
        if (!matchDesc && !matchAmt && !matchNames) return false;
      }
      return true;
    });

    document.getElementById('timelineCountTag').textContent = `${currentRoom.transactions.length} records`;

    if (filtered.length === 0) {
      list.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    list.innerHTML = filtered.map(t => {
      const lender = getMember(t.lenderId);
      const borrower = getMember(t.borrowerId);
      const isLender = t.lenderId === activeMemberId;
      const isBorrower = t.borrowerId === activeMemberId;

      let statusBadge = '';
      if (t.status === 'active') {
        statusBadge = `<span class="tx-status-badge status-active">⏳ Unsettled</span>`;
      } else if (t.status === 'awaiting_confirmation') {
        statusBadge = `<span class="tx-status-badge status-awaiting">🟡 Awaiting Confirmation</span>`;
      } else if (t.status === 'settled') {
        statusBadge = `<span class="tx-status-badge status-settled">✓ Settled & Verified</span>`;
      }

      // STRICT LENDER-ONLY ACTION BUTTON LOGIC
      let actionButtonHtml = '';

      if (t.status === 'settled') {
        // Already settled
        actionButtonHtml = `
          <div class="text-subtle" style="font-size: 0.74rem;">
            Verified by ${escapeHTML(getMember(t.settledBy || t.lenderId).name)}
          </div>
        `;
      } else if (isLender) {
        // ACTIVE USER IS THE LENDER: THEY HAVE THE EXCLUSIVE POWER TO SETTLE!
        actionButtonHtml = `
          <button class="btn-lender-confirm" data-lender-settle="${t.id}" title="Confirm payment received and settle this transaction">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Confirm Received & Settle</span>
          </button>
        `;
      } else if (isBorrower) {
        // ACTIVE USER IS THE BORROWER: CANNOT SETTLE ALONE! CAN ONLY PAY & NOTIFY LENDER!
        if (t.status === 'awaiting_confirmation') {
          actionButtonHtml = `
            <div style="text-align: right;">
              <span class="text-amber" style="font-size: 0.75rem; font-weight: 700;">Waiting for ${escapeHTML(lender.name)}</span>
              <div class="text-subtle" style="font-size: 0.7rem;">Only lender can verify</div>
            </div>
          `;
        } else {
          actionButtonHtml = `
            <button class="btn-borrower-pay" data-borrower-pay="${t.id}" title="Pay lender and notify them to verify settlement">
              <span>Pay & Notify Lender</span>
            </button>
          `;
        }
      } else {
        // Third-party viewer
        actionButtonHtml = `
          <div class="text-subtle" style="font-size: 0.74rem;">
            Owed to ${escapeHTML(lender.name)}
          </div>
        `;
      }

      const formattedDate = formatTime(t.createdAt);

      return `
        <div class="tx-item-card" data-tx-id="${t.id}">
          <div class="tx-item-left">
            <div class="tx-flow-badge">
              <div class="mini-avatar" style="background: ${lender.color};" title="Lender: ${escapeHTML(lender.name)}">
                ${lender.name.charAt(0).toUpperCase()}
              </div>
              <span class="tx-arrow">➔</span>
              <div class="mini-avatar" style="background: ${borrower.color};" title="Borrower: ${escapeHTML(borrower.name)}">
                ${borrower.name.charAt(0).toUpperCase()}
              </div>
            </div>

            <div class="tx-info-content">
              <div class="tx-desc-line">${escapeHTML(t.description)}</div>
              <div class="tx-meta-line">
                <strong>${escapeHTML(lender.name)}</strong> lent to <strong>${escapeHTML(borrower.name)}</strong>
                <span>•</span>
                <span>${formattedDate}</span>
              </div>
              ${!isLender && t.status !== 'settled' ? `
                <div class="tx-lender-notice">
                  <span>🔒 Only ${escapeHTML(lender.name)} (lender) can confirm settlement</span>
                </div>
              ` : ''}
              ${t.note ? `<div class="text-subtle" style="font-size: 0.74rem; font-style: italic;">"${escapeHTML(t.note)}"</div>` : ''}
            </div>
          </div>

          <div class="tx-item-right">
            <div class="tx-amount-display">
              <div class="tx-rupee-val text-green">${formatRupees(t.amount)}</div>
              ${statusBadge}
            </div>

            ${actionButtonHtml}

            <button class="btn-delete-tx" data-delete-tx="${t.id}" title="Delete record">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach Lender Settle Listeners
    list.querySelectorAll('[data-lender-settle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const txId = btn.dataset.lenderSettle;
        openLenderSettleModal(txId);
      });
    });

    // Attach Borrower Pay Listeners
    list.querySelectorAll('[data-borrower-pay]').forEach(btn => {
      btn.addEventListener('click', () => {
        const txId = btn.dataset.borrowerPay;
        openBorrowerPayModal(txId);
      });
    });

    // Attach Delete Listeners
    list.querySelectorAll('[data-delete-tx]').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteTransaction(btn.dataset.deleteTx);
      });
    });
  }

  function renderSavedRooms() {
    const list = document.getElementById('savedRoomsList');
    if (!list) return;

    document.getElementById('savedRoomsBadge').textContent = rooms.length;

    list.innerHTML = rooms.map(r => {
      const isCurrent = r.id === currentRoom.id;
      return `
        <div class="saved-room-card" data-select-room="${r.id}" style="${isCurrent ? 'border-color: var(--accent-primary);' : ''}">
          <div>
            <strong>${escapeHTML(r.name)}</strong>
            <div class="text-subtle" style="font-size: 0.75rem; font-family: var(--font-mono);">
              ${r.id} • ${r.members.length} friends
            </div>
          </div>
          <div>
            ${isCurrent ? '<span style="color: var(--accent-green); font-size: 0.8rem; font-weight: 700;">Active Room ✓</span>' : '<button class="btn btn-ghost btn-sm">Switch</button>'}
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-select-room]').forEach(item => {
      item.addEventListener('click', () => {
        switchRoom(item.dataset.selectRoom);
        closeAllModals();
      });
    });
  }

  // ==========================================
  // 7. RECORD LENDING TRANSACTION
  // ==========================================
  function handleRecordLending(e) {
    e.preventDefault();
    const lenderId = document.getElementById('lenderSelect').value;
    const borrowerId = document.getElementById('borrowerSelect').value;
    const amount = parseFloat(document.getElementById('lendingAmount').value);
    const description = document.getElementById('lendingDesc').value.trim();

    if (!lenderId || !borrowerId) {
      showToast('Please select both lender and borrower', 'error');
      return;
    }

    if (lenderId === borrowerId) {
      showToast('Lender and borrower cannot be the same person', 'error');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount in ₹', 'error');
      return;
    }

    if (!description) {
      showToast('Please enter a short reason/description', 'error');
      return;
    }

    const newTx = {
      id: 'tx_' + Date.now(),
      lenderId,
      borrowerId,
      amount: Math.round(amount),
      description,
      status: 'active',
      createdAt: new Date().toISOString(),
      settledAt: null,
      settledBy: null,
      method: '',
      note: ''
    };

    currentRoom.transactions.unshift(newTx);
    saveRooms(true);
    apiCall('/api/rooms/transaction', 'POST', { roomId: currentRoom.id, transaction: newTx });

    playSound('record');
    const lender = getMember(lenderId);
    const borrower = getMember(borrowerId);
    showToast(`Recorded: ${lender.name} lent ${formatRupees(amount)} to ${borrower.name}`, 'success');

    // Reset inputs
    document.getElementById('lendingAmount').value = '';
    document.getElementById('lendingDesc').value = '';
    renderAll();
  }

  function deleteTransaction(id) {
    if (!confirm('Are you sure you want to delete this record?')) return;
    const idx = currentRoom.transactions.findIndex(t => t.id === id);
    if (idx === -1) return;

    currentRoom.transactions.splice(idx, 1);
    saveRooms(true);
    apiCall('/api/rooms/delete-transaction', 'POST', { roomId: currentRoom.id, txId: id });
    showToast('Transaction deleted', 'info');
    renderAll();
  }

  // ==========================================
  // 8. LENDER-ONLY SETTLEMENT CONFIRMATION
  // ==========================================
  function openLenderSettleModal(txId) {
    const tx = currentRoom.transactions.find(t => t.id === txId);
    if (!tx) return;

    // SECURITY CHECK: Verify active user is indeed the lender
    if (tx.lenderId !== activeMemberId) {
      showToast(`Permission Denied: Only ${getMember(tx.lenderId).name} (the lender) can settle this transaction`, 'error');
      return;
    }

    const modal = document.getElementById('lenderSettleModal');
    const borrower = getMember(tx.borrowerId);

    document.getElementById('settleTxId').value = tx.id;
    document.getElementById('settlePromptSummary').textContent = `${borrower.name} owes you for "${tx.description}"`;
    document.getElementById('settleAmountPrompt').textContent = formatRupees(tx.amount);
    document.getElementById('settleReceivedAmount').value = tx.amount;
    document.getElementById('settleNote').value = '';

    modal.classList.remove('hidden');
    document.getElementById('settleReceivedAmount').focus();
  }

  function handleLenderSettleSubmit(e) {
    e.preventDefault();
    const txId = document.getElementById('settleTxId').value;
    const receivedAmount = parseFloat(document.getElementById('settleReceivedAmount').value);
    const method = document.getElementById('settlePaymentMethod').value;
    const note = document.getElementById('settleNote').value.trim();

    const tx = currentRoom.transactions.find(t => t.id === txId);
    if (!tx) return;

    // Strict Lender Enforcement
    if (tx.lenderId !== activeMemberId) {
      showToast(`Only the person who lent the money can confirm settlement!`, 'error');
      return;
    }

    if (isNaN(receivedAmount) || receivedAmount <= 0) {
      showToast('Please enter a valid received amount', 'error');
      return;
    }

    const lender = getMember(tx.lenderId);
    const borrower = getMember(tx.borrowerId);
    const nowIso = new Date().toISOString();

    // If partial amount received, adjust or mark settled
    if (receivedAmount < tx.amount) {
      const remaining = tx.amount - receivedAmount;
      tx.status = 'settled';
      tx.settledAt = nowIso;
      tx.settledBy = activeMemberId;
      tx.method = method;
      tx.note = `Partial settlement of ${formatRupees(receivedAmount)}. Note: ${note || 'Verified'}`;

      // Create new active transaction for remaining debt
      const remainingTx = {
        id: 'tx_' + Date.now(),
        lenderId: tx.lenderId,
        borrowerId: tx.borrowerId,
        amount: remaining,
        description: `Remaining balance for ${tx.description}`,
        status: 'active',
        createdAt: nowIso,
        settledAt: null,
        settledBy: null,
        method: '',
        note: ''
      };
      currentRoom.transactions.unshift(remainingTx);
      showToast(`Recorded partial payment of ${formatRupees(receivedAmount)}. Remaining: ${formatRupees(remaining)}`, 'success');
    } else {
      // Full settlement
      tx.status = 'settled';
      tx.settledAt = nowIso;
      tx.settledBy = activeMemberId;
      tx.method = method;
      tx.note = note ? `Settled: ${note}` : `Verified received via ${method}`;
      showToast(`Confirmed! ${borrower.name}'s debt of ${formatRupees(tx.amount)} settled.`, 'success');
    }

    saveRooms(true);
    apiCall('/api/rooms/settle', 'POST', {
      roomId: currentRoom.id,
      txId,
      settledBy: activeMemberId,
      amount: receivedAmount,
      method,
      note,
      timestamp: nowIso
    });

    playSound('settle');
    closeAllModals();
    renderAll();
  }

  // ==========================================
  // 9. BORROWER NOTIFY / UPI PAY
  // ==========================================
  let activeBorrowerPayTxId = null;

  function openBorrowerPayModal(txId) {
    const tx = currentRoom.transactions.find(t => t.id === txId);
    if (!tx) return;

    activeBorrowerPayTxId = tx.id;
    const lender = getMember(tx.lenderId);
    const modal = document.getElementById('borrowerPayModal');

    document.getElementById('borrowerPayPrompt').textContent = `Pay ${lender.name} for "${tx.description}"`;
    document.getElementById('borrowerPayAmount').textContent = formatRupees(tx.amount);
    document.getElementById('lenderUpiAddress').textContent = lender.upi ? `Payee UPI: ${lender.upi}` : 'No UPI set. Pay via Cash.';

    modal.classList.remove('hidden');
  }

  function handleNotifyLenderPaid() {
    if (!activeBorrowerPayTxId) return;
    const tx = currentRoom.transactions.find(t => t.id === activeBorrowerPayTxId);
    if (!tx) return;

    tx.status = 'awaiting_confirmation';
    tx.note = `Payment reported sent. Awaiting ${getMember(tx.lenderId).name}'s confirmation.`;

    saveRooms(true);
    apiCall('/api/rooms/notify-paid', 'POST', { roomId: currentRoom.id, txId: activeBorrowerPayTxId });

    playSound('notify');
    showToast(`Notified ${getMember(tx.lenderId).name}! Debt will be settled once they confirm.`, 'success');
    closeAllModals();
    renderAll();
  }

  // ==========================================
  // 10. ROOM & MEMBER OPERATIONS
  // ==========================================
  function handleAddFriendSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('newFriendName').value.trim();
    const upi = document.getElementById('newFriendUpi').value.trim();
    const phone = document.getElementById('newFriendPhone').value.trim();

    if (!name) {
      showToast('Please enter friend name', 'error');
      return;
    }

    const newMember = {
      id: 'm_' + Date.now(),
      name,
      upi,
      phone,
      color: activeFriendColor
    };

    currentRoom.members.push(newMember);
    saveRooms(true);
    apiCall('/api/rooms/add-member', 'POST', { roomId: currentRoom.id, member: newMember });

    playSound('record');
    showToast(`Added ${name} to ${currentRoom.name}!`, 'success');

    closeAllModals();
    renderAll();
  }

  async function handleCreateRoomSubmit(e) {
    e.preventDefault();
    const roomName = document.getElementById('createRoomName').value.trim();
    const yourName = document.getElementById('createYourName').value.trim();
    const initialFriendsStr = document.getElementById('createInitialFriends').value.trim();

    if (!roomName || !yourName) {
      showToast('Please fill in room name and your name', 'error');
      return;
    }

    const randomCode = 'ROOM-' + Math.floor(1000 + Math.random() * 9000);
    const members = [
      { id: 'm_' + Date.now(), name: yourName, upi: '', phone: '', color: '#10b981' }
    ];

    if (initialFriendsStr) {
      const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4'];
      const names = initialFriendsStr.split(',').map(s => s.trim()).filter(Boolean);
      names.forEach((name, i) => {
        members.push({
          id: 'm_' + (Date.now() + i + 1),
          name,
          upi: '',
          phone: '',
          color: colors[i % colors.length]
        });
      });
    }

    const newRoom = {
      id: randomCode,
      name: roomName,
      category: 'Friends Ledger',
      members,
      transactions: [],
      createdAt: new Date().toISOString()
    };

    // Save to master server and locally
    await apiCall('/api/rooms/save', 'POST', newRoom);

    rooms.unshift(newRoom);
    currentRoom = newRoom;
    activeMemberId = members[0].id;
    localStorage.setItem(STORAGE_ACTIVE_ROOM_ID, newRoom.id);
    localStorage.setItem(STORAGE_ACTIVE_USER_ID, activeMemberId);
    saveRooms(true);

    playSound('record');
    closeAllModals();
    renderAll();

    // Show room celebration modal with ready invite link & code
    openRoomCreatedModal(newRoom);
  }

  async function handleJoinRoomSubmit(e) {
    e.preventDefault();
    const code = document.getElementById('joinRoomCodeInput').value.trim().toUpperCase();
    const yourName = document.getElementById('joinYourNameInput').value.trim();
    const yourUpi = (document.getElementById('joinYourUpiInput')?.value || '').trim();

    if (!code) {
      showToast('Please enter a 4-digit room code', 'error');
      return;
    }

    showToast(`Joining ${code}...`, 'info');

    // Call server join API
    const res = await apiCall('/api/rooms/join', 'POST', {
      roomId: code,
      userName: yourName,
      upi: yourUpi
    });

    if (res && res.success && res.room) {
      const joinedRoom = res.room;
      const existingIdx = rooms.findIndex(r => r.id === joinedRoom.id);
      if (existingIdx >= 0) rooms[existingIdx] = joinedRoom;
      else rooms.unshift(joinedRoom);

      currentRoom = joinedRoom;
      activeMemberId = res.memberId || joinedRoom.members[0].id;
      localStorage.setItem(STORAGE_ACTIVE_ROOM_ID, currentRoom.id);
      localStorage.setItem(STORAGE_ACTIVE_USER_ID, activeMemberId);
      saveRooms(false);

      closeAllModals();
      playSound('record');
      showToast(`🎉 Joined "${joinedRoom.name}" as ${yourName || getMember(activeMemberId).name}!`, 'success');
      renderAll();
      return;
    }

    // Fallback: check local rooms
    const localFound = rooms.find(r => r.id === code);
    if (localFound) {
      switchRoom(localFound.id);
      closeAllModals();
      showToast(`Joined ${localFound.name}!`, 'success');
    } else {
      showToast(`Room code "${code}" not found. Verify the code with your friend.`, 'error');
    }
  }

  function switchRoom(roomId) {
    const found = rooms.find(r => r.id === roomId);
    if (!found) return;

    currentRoom = found;
    activeMemberId = found.members[0].id;
    localStorage.setItem(STORAGE_ACTIVE_ROOM_ID, currentRoom.id);
    localStorage.setItem(STORAGE_ACTIVE_USER_ID, activeMemberId);
    renderAll();
  }

  function openRoomCreatedModal(room) {
    const modal = document.getElementById('roomCreatedModal');
    if (!modal) return;

    document.getElementById('createdRoomCodeBig').textContent = room.id;
    document.getElementById('createdRoomNameSub').textContent = room.name;
    document.getElementById('createdRoomLinkInput').value = getShareLink(room.id);
    modal.classList.remove('hidden');
  }

  function openWelcomeModal(room) {
    const modal = document.getElementById('welcomeJoinModal');
    if (!modal) return;

    document.getElementById('welcomeModalRoomTitle').textContent = `Welcome to "${room.name}" 👋`;
    const list = document.getElementById('welcomeMemberList');
    list.innerHTML = room.members.map(m => `
      <button type="button" class="member-choice-btn" data-pick-member="${m.id}">
        <span class="peer-avatar" style="background:${m.color || '#6366f1'}; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700;">
          ${m.name.charAt(0).toUpperCase()}
        </span>
        <span>${escapeHTML(m.name)}</span>
      </button>
    `).join('');

    list.querySelectorAll('[data-pick-member]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeMemberId = btn.dataset.pickMember;
        localStorage.setItem(STORAGE_ACTIVE_USER_ID, activeMemberId);
        closeAllModals();
        playSound('record');
        showToast(`Signed in as ${getMember(activeMemberId).name}!`, 'success');
        renderAll();
      });
    });

    modal.classList.remove('hidden');
  }

  // ==========================================
  // 11. SHARING & HELPERS
  // ==========================================
  function copyRoomCode() {
    if (!currentRoom) return;
    navigator.clipboard.writeText(currentRoom.id).then(() => {
      playSound('record');
      showToast(`Copied Room Code: ${currentRoom.id}!`, 'success');
    }).catch(() => {
      showToast(`Room Code: ${currentRoom.id}`, 'info');
    });
  }

  function copyRoomInviteLink() {
    if (!currentRoom) return;
    const link = getShareLink(currentRoom.id);
    navigator.clipboard.writeText(link).then(() => {
      playSound('record');
      showToast(`Copied Room Invite Link for friends! 🔗`, 'success');
    }).catch(() => {
      prompt('Copy this invite link for your friends:', link);
    });
  }

  function shareWhatsAppInvite() {
    if (!currentRoom) return;
    const link = getShareLink(currentRoom.id);
    let text = `*Join our RokkaLE Ledger Room!* 💰\n\n`;
    text += `Room: *${currentRoom.name}*\n`;
    text += `Room Code: *${currentRoom.id}*\n\n`;
    text += `Open this link on your phone to join, view balances, and settle debts in Rupees (₹):\n${link}\n\n`;
    text += `(Only the lender who gave the money can confirm settlement!)`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }

  function shareWhatsAppSummary() {
    const activeMember = getMember(activeMemberId);
    const { owedToMe, youOwe, net } = calculateMyStanding();

    let text = `*RokkaLE Ledger Summary (${currentRoom.name})*\n`;
    text += `Room Code: ${currentRoom.id}\n`;
    text += `Summary for: ${activeMember.name}\n\n`;

    text += `💸 You are owed: ${formatRupees(owedToMe)}\n`;
    text += `🤝 You owe: ${formatRupees(youOwe)}\n`;
    text += `⚖️ Net Standing: ${(net < 0 ? '-' : '') + formatRupees(net)}\n\n`;

    text += `*Friends Breakdown:*\n`;
    currentRoom.members.filter(m => m.id !== activeMemberId).forEach(m => {
      const { balance } = calculatePeerBalance(m.id);
      if (balance > 0) {
        text += `• ${m.name} owes you ${formatRupees(balance)}\n`;
      } else if (balance < 0) {
        text += `• You owe ${m.name} ${formatRupees(Math.abs(balance))}\n`;
      }
    });

    text += `\nTrack & verify debts together: ${getShareLink(currentRoom.id)}`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }

  function openCreateRoomModal() {
    switchRoomManagerTab('panelCreateRoom', 'tabCreateRoom');
    document.getElementById('roomManagerModal')?.classList.remove('hidden');
    document.getElementById('createRoomName')?.focus();
  }

  function openJoinRoomModal() {
    switchRoomManagerTab('panelJoinRoom', 'tabJoinRoom');
    document.getElementById('roomManagerModal')?.classList.remove('hidden');
    document.getElementById('joinRoomCodeInput')?.focus();
  }

  function switchRoomManagerTab(panelId, tabId) {
    document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(panelId)?.classList.add('active');
    document.getElementById(tabId)?.classList.add('active');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================
  // 12. EVENT LISTENERS SETUP
  // ==========================================
  function setupEventListeners() {
    // Active User Switcher
    document.getElementById('activeUserSelect')?.addEventListener('change', (e) => {
      activeMemberId = e.target.value;
      localStorage.setItem(STORAGE_ACTIVE_USER_ID, activeMemberId);
      playSound('record');
      showToast(`Now viewing as: ${getMember(activeMemberId).name}`, 'info');
      renderAll();
    });

    // Theme toggle
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(STORAGE_THEME, next);
    });

    // Quick Room Header Buttons
    document.getElementById('headerCreateRoomBtn')?.addEventListener('click', openCreateRoomModal);
    document.getElementById('headerJoinRoomBtn')?.addEventListener('click', openJoinRoomModal);
    document.getElementById('heroCreateRoomBtn')?.addEventListener('click', openCreateRoomModal);
    document.getElementById('heroJoinRoomBtn')?.addEventListener('click', openJoinRoomModal);

    // Hero Action Bar Sharing Buttons
    document.getElementById('heroCopyCodeBtn')?.addEventListener('click', copyRoomCode);
    document.getElementById('heroShareLinkBtn')?.addEventListener('click', copyRoomInviteLink);
    document.getElementById('heroWhatsAppBtn')?.addEventListener('click', shareWhatsAppInvite);

    // Header Room ID badge click
    document.getElementById('copyRoomCodeBtn')?.addEventListener('click', copyRoomInviteLink);
    document.getElementById('roomCodePill')?.addEventListener('click', copyRoomInviteLink);
    document.getElementById('whatsappSummaryBtn')?.addEventListener('click', shareWhatsAppSummary);

    // Forms
    document.getElementById('recordLendingForm')?.addEventListener('submit', handleRecordLending);
    document.getElementById('lenderSettleForm')?.addEventListener('submit', handleLenderSettleSubmit);
    document.getElementById('addFriendForm')?.addEventListener('submit', handleAddFriendSubmit);
    document.getElementById('createRoomForm')?.addEventListener('submit', handleCreateRoomSubmit);
    document.getElementById('joinRoomForm')?.addEventListener('submit', handleJoinRoomSubmit);

    // Welcome Guest Modal New Member Form
    document.getElementById('welcomeNewMemberForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('welcomeNewNameInput');
      const name = input ? input.value.trim() : '';
      if (!name) return;

      const res = await apiCall('/api/rooms/join', 'POST', {
        roomId: currentRoom.id,
        userName: name
      });

      if (res && res.success) {
        currentRoom = res.room;
        activeMemberId = res.memberId;
        localStorage.setItem(STORAGE_ACTIVE_USER_ID, activeMemberId);
        saveRooms(false);
        closeAllModals();
        playSound('record');
        showToast(`Welcome ${name}! You've joined the room.`, 'success');
        renderAll();
      }
    });

    // Borrower notification button
    document.getElementById('notifyLenderPaidBtn')?.addEventListener('click', handleNotifyLenderPaid);
    document.getElementById('copyLenderUpiBtn')?.addEventListener('click', () => {
      if (!activeBorrowerPayTxId) return;
      const tx = currentRoom.transactions.find(t => t.id === activeBorrowerPayTxId);
      if (tx) {
        const lender = getMember(tx.lenderId);
        if (lender.upi) {
          navigator.clipboard.writeText(lender.upi).then(() => {
            showToast('Lender UPI ID copied!', 'success');
          });
        }
      }
    });

    // Preset chips
    document.querySelectorAll('.tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.getElementById('lendingDesc').value = chip.dataset.preset;
        document.getElementById('lendingAmount').focus();
      });
    });

    // Tap rupee amount chips
    document.querySelectorAll('.amt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.dataset.amt;
        const input = document.getElementById('lendingAmount');
        input.value = val;
        playSound('record');
        input.focus();
      });
    });

    // Filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilter = chip.dataset.filter;
        renderTransactionsTimeline();
      });
    });

    // Search filter
    document.getElementById('txSearchInput')?.addEventListener('input', renderTransactionsTimeline);

    // Add friend modal trigger
    document.getElementById('addFriendToRoomBtn')?.addEventListener('click', () => {
      document.getElementById('addFriendForm').reset();
      document.getElementById('addFriendModal').classList.remove('hidden');
    });

    // Room manager modal trigger
    document.getElementById('roomManageBtn')?.addEventListener('click', () => {
      switchRoomManagerTab('panelMyRooms', 'tabMyRooms');
      document.getElementById('roomManagerModal').classList.remove('hidden');
    });

    // Color dot picker in add friend modal
    document.querySelectorAll('#friendColorDots .color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('#friendColorDots .color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        activeFriendColor = dot.dataset.color;
      });
    });

    // Modal tabs in room manager
    document.getElementById('tabCreateRoom')?.addEventListener('click', () => {
      switchRoomManagerTab('panelCreateRoom', 'tabCreateRoom');
    });
    document.getElementById('tabJoinRoom')?.addEventListener('click', () => {
      switchRoomManagerTab('panelJoinRoom', 'tabJoinRoom');
    });
    document.getElementById('tabMyRooms')?.addEventListener('click', () => {
      switchRoomManagerTab('panelMyRooms', 'tabMyRooms');
    });

    // Room Created Celebration Modal triggers
    document.getElementById('copyCreatedRoomLinkBtn')?.addEventListener('click', () => {
      const input = document.getElementById('createdRoomLinkInput');
      if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
          showToast('Copied room invite link! 🔗', 'success');
        });
      }
    });

    document.getElementById('shareCreatedWhatsAppBtn')?.addEventListener('click', shareWhatsAppInvite);
    document.getElementById('enterCreatedRoomBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('closeRoomCreatedBtn')?.addEventListener('click', closeAllModals);

    // Modal close buttons
    document.getElementById('closeWelcomeModalBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('closeLenderSettleBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('cancelLenderSettleBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('closeBorrowerPayBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('closeAddFriendBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('cancelAddFriendBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('closeRoomManagerBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('closeInstallModalBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('cancelInstallBtn')?.addEventListener('click', closeAllModals);

    // Install App button
    document.getElementById('installAppBtn')?.addEventListener('click', () => {
      document.getElementById('installAppModal')?.classList.remove('hidden');
    });

    // PWA BeforeInstallPrompt Handler
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const installArea = document.getElementById('pwaNativeInstallArea');
      if (installArea) installArea.classList.remove('hidden');
    });

    document.getElementById('triggerNativeInstallBtn')?.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          showToast('Thank you for installing RokkaLE App! 🎉', 'success');
        }
        deferredPrompt = null;
        closeAllModals();
      } else {
        showToast('App is ready! On mobile, tap Share ➔ Add to Home Screen', 'info');
      }
    });

    // Backdrop clicks
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAllModals();
      });
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });
  }

  // ==========================================
  // 13. BOOTSTRAP & SERVICE WORKER
  // ==========================================
  function init() {
    loadData();
    setupEventListeners();
    renderAll();

    // Clear any old PWA caches to force immediate refresh
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          if (name !== 'rokkale-cache-v4') caches.delete(name);
        });
      });
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js?v=4')
        .then(() => console.log('RokkaLE PWA Service Worker Registered'))
        .catch(err => console.log('Service Worker setup skipped:', err));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
