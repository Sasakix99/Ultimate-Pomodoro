/* =========================
   ✅ SUPABASE + AUTH SIMPLE
   ========================= */
const SUPABASE_URL = "https://lznudwhylxlrggogkmwy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qUjwWqfIiEkmkfg6YObZMQ_RlxwhCHK";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null; // { id, username }
const LOCAL_USER_KEY = "pomodoro_current_user_v1";

// Hash SHA-256 (pour ne pas stocker le code en clair)
async function sha256(text){
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function setAuthStatus(msg){
  $("#authStatus").text(msg || "");
}

function loadSavedUser(){
  try{
    const raw = localStorage.getItem(LOCAL_USER_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function saveUserLocal(u){
  try{ localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(u)); }catch(e){}
}
function logoutLocal(){
  try{ localStorage.removeItem(LOCAL_USER_KEY); }catch(e){}
  currentUser = null;
  $("#authBox").show();
  setAuthStatus("");
}

// Créer profil (username unique + code)
async function signup(username, code){
  username = (username || "").trim();
  code = (code || "").trim();
  if(!username || !code) throw new Error("Entre un nom + un code.");

  const pin_hash = await sha256(code);

  const { data, error } = await supabase
    .from("profiles")
    .insert([{ username, pin_hash }])
    .select("id, username")
    .single();

  if(error) throw error;

  currentUser = data;
  saveUserLocal(currentUser);
  $("#authBox").hide();
  setAuthStatus("");
  return data;
}

// Se connecter (vérifie le hash)
async function login(username, code){
  username = (username || "").trim();
  code = (code || "").trim();
  if(!username || !code) throw new Error("Entre un nom + un code.");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, pin_hash")
    .eq("username", username)
    .single();

  if(error) throw error;

  const pin_hash = await sha256(code);
  if(pin_hash !== data.pin_hash) throw new Error("Code incorrect.");

  currentUser = { id: data.id, username: data.username };
  saveUserLocal(currentUser);
  $("#authBox").hide();
  setAuthStatus("");
  return currentUser;
}

/* =========================
   ✅ TIMER STATE <-> SUPABASE
   ========================= */
function buildStateObject(){
  return {
    inputs: {
      goal: $("#goalTimeInput").val(),
      session: $("#sessionLengthInput").val(),
      break: $("#breakLengthInput").val(),
      perpetual: $("#perpetual").is(":checked")
    },

    totalFocusMinutes,
    sessionsCompleted,

    currentMode,
    startSeconds,
    taskInitialSeconds,
    taskCountedSeconds,

    targetEndTime,
    pausedRemainingSeconds,

    pausedFocusedSecSnapshot,
    pausedRemainingFocusSecSnapshot,

    savedAt: Date.now(),
    v: 1
  };
}

function applyStateObject(st){
  if(!st || st.v !== 1) return;

  if(st.inputs){
    if(typeof st.inputs.goal === "string") $("#goalTimeInput").val(st.inputs.goal);
    if(typeof st.inputs.session === "string") $("#sessionLengthInput").val(st.inputs.session);
    if(typeof st.inputs.break === "string") $("#breakLengthInput").val(st.inputs.break);
    if(typeof st.inputs.perpetual === "boolean") $("#perpetual").prop("checked", st.inputs.perpetual);
  }

  totalFocusMinutes = st.totalFocusMinutes || 0;
  sessionsCompleted = st.sessionsCompleted || 0;

  currentMode = st.currentMode || "task";
  startSeconds = (st.startSeconds ?? null);
  taskInitialSeconds = (st.taskInitialSeconds ?? null);
  taskCountedSeconds = st.taskCountedSeconds || 0;

  targetEndTime = (st.targetEndTime ?? null);
  pausedRemainingSeconds = (st.pausedRemainingSeconds ?? null);

  pausedFocusedSecSnapshot = (st.pausedFocusedSecSnapshot ?? null);
  pausedRemainingFocusSecSnapshot = (st.pausedRemainingFocusSecSnapshot ?? null);
}

async function loadRemoteState(){
  if(!currentUser) return null;

  const { data, error } = await supabase
    .from("timer_state")
    .select("state_json")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if(error) throw error;
  return data?.state_json || null;
}

async function saveRemoteState(){
  if(!currentUser) return;

  const state = buildStateObject();

  const { error } = await supabase
    .from("timer_state")
    .upsert([{ user_id: currentUser.id, state_json: state, updated_at: new Date().toISOString() }]);

  if(error) console.warn("saveRemoteState error:", error.message || error);
}

let _lastRemoteSave = 0;
async function saveRemoteStateThrottled(){
  const now = Date.now();
  if(now - _lastRemoteSave < 2000) return; // 1 save / 2s
  _lastRemoteSave = now;
  await saveRemoteState();
}

/* =========================
   ✅ HISTORIQUE (par jour)
   ========================= */
function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

async function upsertTodayHistory(){
  if(!currentUser) return;
  const day = todayISO();
  const focused_seconds = effectiveFocusSeconds();
  const sessions_completed = sessionsCompleted;

  // ⚠️ Nécessite un unique constraint sur (user_id, day)
  const { error } = await supabase
    .from("focus_history")
    .upsert([{
      user_id: currentUser.id,
      day,
      focused_seconds: Math.floor(focused_seconds),
      sessions_completed: sessions_completed
    }], { onConflict: "user_id,day" });

  if(error) console.warn("history upsert error:", error.message || error);
}

let _lastHistorySave = 0;
async function upsertTodayHistoryThrottled(){
  const now = Date.now();
  if(now - _lastHistorySave < 5000) return; // 1 update / 5s
  _lastHistorySave = now;
  await upsertTodayHistory();
}

/* =========================
   ✅ TON TIMER (code original)
   ========================= */

/* ========= Utilitaires ========= */
function parseDurationToSeconds(str){
  if(!str) return null;
  str = String(str).trim().toLowerCase();
  if(str === '') return null;

  // h:mm
  if(str.includes(':')){
    var parts = str.split(':');
    var h = parseInt(parts[0],10) || 0;
    var m = parseInt(parts[1],10) || 0;
    return (h*60 + m) * 60;
  }
  // suffixes 2h15, 90m, 2h, 45m
  var hMatch = str.match(/(\d+)\s*h/);
  var mMatch = str.match(/(\d+)\s*m/);
  if(hMatch || mMatch){
    var h = hMatch ? parseInt(hMatch[1],10) : 0;
    var m = mMatch ? parseInt(mMatch[1],10) : 0;
    return (h*60 + m) * 60;
  }
  // nombre brut = minutes
  var n = parseInt(str,10);
  if(!isNaN(n)) return n*60;

  return null;
}
function formatHMSfromSeconds(sec){
  sec = Math.max(0, Math.round(sec));
  var h=Math.floor(sec/3600), m=Math.floor((sec-h*3600)/60), s=sec-h*3600-m*60;
  if(s<10&&m>0)s='0'+s; if(m<10&&h>0)m='0'+m;
  var t=(h===0)?(m+':'+s):(h+':'+m+':'+s); if(h===0&&m===0)t=s;
  return t;
}
function formatTimeOfDay(date){
  const hh = date.getHours();
  const mm = date.getMinutes();
  const H = (hh < 10 ? '0' : '') + hh;
  const M = (mm < 10 ? '0' : '') + mm;
  return `${H}h${M}`;
}
/* Units minuscules pour Focus & Restant */
function formatHMSUnitsLower(sec){
  sec = Math.max(0, Math.round(sec));
  var h = Math.floor(sec/3600);
  var m = Math.floor((sec - h*3600)/60);
  var s = sec - h*3600 - m*60;
  if(h > 0) return `${h}h${m}m${s}s`;
  if(m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

/* ========= État ========= */
var startSeconds,
    totalFocusMinutes = 0,
    sessionsCompleted = 0,
    tickTimer = null;

var currentMode = 'task';
var taskInitialSeconds = null;
var taskCountedSeconds = 0;

var targetEndTime = null;
var lastShownSeconds = null;
var pausedRemainingSeconds = null;

var RADIUS=80, CIRCUMFERENCE=2*Math.PI*RADIUS;

/* === Nouveaux snapshots pour la PAUSE === */
var pausedFocusedSecSnapshot = null;
var pausedRemainingFocusSecSnapshot = null;

function isPaused(){
  return (targetEndTime==null && pausedRemainingSeconds!=null);
}

/* ========= Sons ========= */
var dingTaskEnd  = new Audio("https://files.catbox.moe/86hbuo.mp3");
var dingBreakEnd = new Audio("https://files.catbox.moe/am7eme.mp3");
function play(audio){ try{ audio.currentTime=0; audio.play().catch(()=>{});}catch(e){} }

/* ========= Anneau + affichage ========= */
function updateRing(p){
  p=Math.max(0,Math.min(1,p));
  var off=CIRCUMFERENCE*(1-p);
  var ring = document.getElementById('ringProgress');
  if(!ring) return;
  ring.setAttribute('stroke-dasharray', CIRCUMFERENCE);
  ring.setAttribute('stroke-dashoffset', off);
}
function showClock(sec){
  var el = document.getElementById('clockTime');
  if(!el) return;
  el.innerHTML = formatHMSfromSeconds(sec);
  if(startSeconds){ updateRing(1-(sec/startSeconds)); }
}

/* ========= Tick ========= */
function startTick(){ stopTick(); lastShownSeconds=null; tickTimer=setInterval(tick,250); tick(); }
function stopTick(){ if(tickTimer){ clearInterval(tickTimer); tickTimer=null; } }
function secondsRemainingNow(){
  if(targetEndTime==null) return pausedRemainingSeconds ?? 0;
  var ms=Math.max(0,targetEndTime-Date.now());
  return Math.round(ms/1000);
}
function hardUpdateFromNow(){
  if(targetEndTime==null) return;
  var sec=secondsRemainingNow();
  showClock(sec);
  if(sec===0) onSegmentEnd();
  updateStatsUI();
  renderFocus();
  renderCompletedMinutes();
}

/* ========= Focus effectif ========= */
function effectiveFocusSeconds(){
  if(isPaused() && pausedFocusedSecSnapshot!=null){
    return pausedFocusedSecSnapshot;
  }

  var base = totalFocusMinutes*60;
  if(currentMode==='task' && taskInitialSeconds!=null){
    var remaining = secondsRemainingNow();
    var remainingForElapsed = (targetEndTime==null && pausedRemainingSeconds!=null) ? pausedRemainingSeconds : remaining;
    if(typeof remainingForElapsed !== 'number') remainingForElapsed = 0;

    var elapsedThisTask = taskInitialSeconds - Math.max(0, remainingForElapsed);
    elapsedThisTask = Math.max(0, elapsedThisTask - taskCountedSeconds);
    base += elapsedThisTask;
  }
  return Math.max(0, base);
}

/* ========= UI ========= */
function renderFocus(){
  var sec = effectiveFocusSeconds();
  document.getElementById('focusValue').textContent = formatHMSUnitsLower(sec);
}
function renderCompletedMinutes(){
  var sec = effectiveFocusSeconds();
  var minutes = Math.floor(sec / 60);
  document.getElementById('completedMinutesValue').textContent = minutes;
}
function renderSessions(){
  document.getElementById('sessionsValue').textContent = String(sessionsCompleted);
}

/* ========= Statistiques ========= */
function updateStatsUI(){
  var goalS     = parseDurationToSeconds($('#goalTimeInput').val());
  var sessionS  = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  var breakS    = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

  var focusedSec = isPaused() && pausedFocusedSecSnapshot!=null
      ? pausedFocusedSecSnapshot
      : effectiveFocusSeconds();

  var remainingFocusSec = null;
  if(goalS!=null){
    remainingFocusSec = isPaused() && pausedRemainingFocusSecSnapshot!=null
      ? pausedRemainingFocusSecSnapshot
      : Math.max(0, goalS - focusedSec);
  }

  var sessionsRemaining = null;
  if(goalS!=null && sessionS>0){
    sessionsRemaining = Math.ceil(remainingFocusSec / sessionS);
  }

  var etaText = '—';
  if(remainingFocusSec!=null){
    var breaksCount = sessionsRemaining!=null ? Math.max(0, sessionsRemaining-1) : 0;
    var etaTotalSec = remainingFocusSec + breaksCount*breakS;
    var etaDate = new Date(Date.now() + etaTotalSec*1000);
    etaText = formatTimeOfDay(etaDate);
  }

  document.getElementById('remainingFocusValue').textContent =
    (remainingFocusSec!=null) ? formatHMSUnitsLower(remainingFocusSec) : '—';
  document.getElementById('sessionsRemaining').textContent =
    (sessionsRemaining!=null) ? sessionsRemaining : '—';
  document.getElementById('etaFinish').textContent = etaText;
}

/* ========= Fin de segment ========= */
function onSegmentEnd(){
  if(targetEndTime==null) return;
  targetEndTime=null; pausedRemainingSeconds=null; stopTick();
  pausedFocusedSecSnapshot=null; pausedRemainingFocusSecSnapshot=null;

  if(currentMode==='task'){
    var rest=Math.max(0, taskInitialSeconds-taskCountedSeconds);
    if(rest>0){
      totalFocusMinutes+=Math.round(rest/60);
      taskCountedSeconds=taskInitialSeconds;
    }
    play(dingTaskEnd);
    sessionsCompleted += 1;
    renderSessions();
    startNext('break');
  } else {
    play(dingBreakEnd);
    startNext('task');
  }

  // save + history
  if(currentUser){ saveRemoteStateThrottled(); upsertTodayHistoryThrottled(); }
}

/* ========= Prochain segment ========= */
function startNext(mode){
  currentMode=mode;
  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  var breakS   = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

  if(mode==='task'){ taskInitialSeconds=sessionS; taskCountedSeconds=0; startSeconds=taskInitialSeconds; }
  else { startSeconds=breakS; }

  showClock(startSeconds); updateRing(0);

  if($('#perpetual').is(':checked')){
    $('#playPauseButton').attr('class','fa fa-pause fa-stack-1x');
    targetEndTime=Date.now()+startSeconds*1000; startTick();
  } else {
    $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  }
  updateStatsUI();
  renderFocus();
  renderCompletedMinutes();

  if(currentUser){ saveRemoteStateThrottled(); upsertTodayHistoryThrottled(); }
}

/* ========= tick ========= */
function tick(){
  if(targetEndTime==null) return;
  var sec=secondsRemainingNow();
  if(lastShownSeconds===null||sec!==lastShownSeconds){
    showClock(sec);
    lastShownSeconds=sec;
    if(sec===0) onSegmentEnd();
    updateStatsUI();
    renderFocus();
    renderCompletedMinutes();

    if(currentUser){ saveRemoteStateThrottled(); upsertTodayHistoryThrottled(); }
  }
}

/* =========================
   ✅ RESTORE après login
   ========================= */
async function afterLoginRestore(){
  const remote = await loadRemoteState();

  if(remote){
    applyStateObject(remote);
    renderSessions();

    // timer en cours ?
    if(targetEndTime != null){
      const sec = secondsRemainingNow();
      if(sec <= 0){
        showClock(0);
        onSegmentEnd();
      }else{
        if(!startSeconds){
          const sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
          const breakS   = parseDurationToSeconds($('#breakLengthInput').val()) || 0;
          startSeconds = (currentMode === "task") ? (taskInitialSeconds || sessionS) : breakS;
        }
        showClock(sec);
        $('#playPauseButton').attr('class','fa fa-pause fa-stack-1x');
        startTick();
      }
    } else if(pausedRemainingSeconds != null){
      // pause
      if(!startSeconds){
        const sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
        const breakS   = parseDurationToSeconds($('#breakLengthInput').val()) || 0;
        startSeconds = (currentMode === "task") ? (taskInitialSeconds || sessionS) : breakS;
      }
      showClock(pausedRemainingSeconds);
      $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
    } else {
      // idle
      const sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 2*3600;
      startSeconds = sessionS;
      showClock(sessionS);
      updateRing(0);
      $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
    }

    renderFocus();
    renderCompletedMinutes();
    updateStatsUI();

  } else {
    // pas d’état en DB encore
    await saveRemoteState();
    await upsertTodayHistory();
  }
}

/* =========================
   ✅ INIT + HANDLERS (jQuery)
   ========================= */
$(function(){
  // Défauts
  $('#goalTimeInput').val('10h');
  $('#sessionLengthInput').val('2h');
  $('#breakLengthInput').val('25m');
  $('#perpetual').prop('checked', true);

  renderSessions();
  renderFocus();
  renderCompletedMinutes();
  updateRing(0);

  // cadran initial
  var sessionS0 = parseDurationToSeconds($('#sessionLengthInput').val()) || 2*3600;
  startSeconds = sessionS0;
  showClock(sessionS0);

  document.addEventListener('visibilitychange', () => {
    hardUpdateFromNow();
    if(currentUser){ saveRemoteStateThrottled(); upsertTodayHistoryThrottled(); }
  });

  // Update UI quand inputs changent
  $('#goalTimeInput, #sessionLengthInput, #breakLengthInput').on('input', function(){
    if(targetEndTime==null && pausedRemainingSeconds==null && currentMode==='task'){
      var ss = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
      startSeconds = ss>0? ss : 0;
      showClock(startSeconds);
      updateRing(0);
    }
    updateStatsUI();
    renderFocus();
    renderCompletedMinutes();

    if(currentUser){ saveRemoteStateThrottled(); upsertTodayHistoryThrottled(); }
  });

  // Auth buttons
  $(document).on("click", "#btnSignup", async function(){
    try{
      setAuthStatus("Création du profil...");
      await signup($("#authUsername").val(), $("#authCode").val());
      setAuthStatus("Profil créé. Chargement...");
      await afterLoginRestore();
      setAuthStatus("");
    }catch(e){
      setAuthStatus("Erreur: " + (e.message || e));
    }
  });

  $(document).on("click", "#btnLogin", async function(){
    try{
      setAuthStatus("Connexion...");
      await login($("#authUsername").val(), $("#authCode").val());
      setAuthStatus("Connecté. Chargement...");
      await afterLoginRestore();
      setAuthStatus("");
    }catch(e){
      setAuthStatus("Erreur: " + (e.message || e));
    }
  });

  // Auto-login via localStorage
  (async function(){
    const u = loadSavedUser();
    if(u && u.id && u.username){
      currentUser = u;
      $("#authBox").hide();
      try{
        await afterLoginRestore();
      }catch(e){
        console.warn(e);
        logoutLocal();
      }
    } else {
      $("#authBox").show();
    }
  })();

  // Autosave (toutes les 1s, throttle inside)
  setInterval(async () => {
    if(!currentUser) return;
    await saveRemoteStateThrottled();
    await upsertTodayHistoryThrottled();
  }, 1000);

  // Play/Pause
  $(document).on("click", "#playPauseButton", function(){
    var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
    var breakS   = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

    if($(this).hasClass('fa-pause')){
      // === PAUSE ===
      $(this).attr('class','fa fa-play fa-stack-1x');

      var remaining = secondsRemainingNow();
      pausedRemainingSeconds = remaining;
      targetEndTime = null;
      stopTick();

      if(currentMode==='task' && taskInitialSeconds!=null){
        var elapsed = taskInitialSeconds - remaining - taskCountedSeconds;
        if(elapsed>0){
          taskCountedSeconds += elapsed;
          totalFocusMinutes += Math.round(elapsed/60);
        }
      }

      pausedFocusedSecSnapshot = effectiveFocusSeconds();

      var goalS = parseDurationToSeconds($('#goalTimeInput').val());
      if(goalS!=null){
        pausedRemainingFocusSecSnapshot = Math.max(0, goalS - pausedFocusedSecSnapshot);
      } else {
        pausedRemainingFocusSecSnapshot = null;
      }

      renderFocus();
      renderCompletedMinutes();
      updateStatsUI();

      if(currentUser){ saveRemoteStateThrottled(); upsertTodayHistoryThrottled(); }

    } else {
      // === PLAY / RESUME ===
      $(this).attr('class','fa fa-pause fa-stack-1x');

      pausedFocusedSecSnapshot = null;
      pausedRemainingFocusSecSnapshot = null;

      if(pausedRemainingSeconds != null){
        if(currentMode==='task'){
          if(taskInitialSeconds==null){ taskInitialSeconds = sessionS; }
          startSeconds = taskInitialSeconds;
        } else {
          startSeconds = breakS;
        }
        showClock(pausedRemainingSeconds);
        targetEndTime = Date.now() + pausedRemainingSeconds*1000;
        pausedRemainingSeconds = null;
        startTick();

      } else if(targetEndTime==null){
        if(currentMode==='task'){
          taskInitialSeconds = sessionS;
          taskCountedSeconds = 0;
          startSeconds = taskInitialSeconds;
        } else {
          startSeconds = breakS;
        }
        targetEndTime = Date.now()+startSeconds*1000;
        showClock(startSeconds); updateRing(0);
        startTick();

      } else {
        startTick();
      }

      if(currentUser){ saveRemoteStateThrottled(); upsertTodayHistoryThrottled(); }
    }
  });

  // Reset
  $(document).on("click", "#resetClockButton", function(){
    stopTick(); targetEndTime=null; startSeconds=null; pausedRemainingSeconds=null;
    pausedFocusedSecSnapshot=null; pausedRemainingFocusSecSnapshot=null;
    $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
    currentMode='task'; taskInitialSeconds=null; taskCountedSeconds=0;

    var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
    startSeconds = sessionS;
    showClock(sessionS); updateRing(0);
    updateStatsUI();
    renderFocus();
    renderCompletedMinutes();

    if(currentUser){ saveRemoteStateThrottled(); upsertTodayHistoryThrottled(); }
  });

  updateStatsUI();
});