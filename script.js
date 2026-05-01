/***********************
 * SUPABASE CONFIG
 ***********************/
const SUPABASE_URL = "https://lznudwhylxlrggogkmwy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qUjwWqfIiEkmkfg6YObZMQ_RlxwhCHK";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/***********************
 * AUTH STATE
 ***********************/
let currentUser = null;
let autosaveInterval = null;
let lastSavedEpochSec = null;

let endedDayISO = null;
let endedDayFinalSeconds = null;
let endedDayFinalSessions = null;

let goalExplodedTodayISO = null;

function setAuthStatus(msg){
  const el = document.getElementById("authStatus");
  if(el) el.textContent = msg || "";
}

/***********************
 * HASH PIN
 ***********************/
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

/***********************
 * AUDIO CUES
 * Focus : 2 sec avant fin
 * Pause : 10 sec avant fin
 ***********************/
const SOUND_FOCUS_URL = "https://files.catbox.moe/86hbuo.mp3";
const SOUND_BREAK_URL = "https://cdn.shopify.com/s/files/1/0935/0132/5648/files/majestic.mp3?v=1777663414";

const audioFocus = new Audio(SOUND_FOCUS_URL);
audioFocus.preload = "auto";

const audioBreak = new Audio(SOUND_BREAK_URL);
audioBreak.preload = "auto";

let lastSoundCueKey = null;

function playSound(aud){
  if(!aud) return;
  try{
    aud.currentTime = 0;
    const p = aud.play();
    if(p && typeof p.catch === "function") p.catch(()=>{});
  } catch(e){}
}

function segmentCueKey(suffix){
  return `${currentMode}|${targetEndTime ?? "paused"}|${suffix}`;
}

/***********************
 * UI SHOW/HIDE
 ***********************/
function showAfterLogin(){
  document.getElementById("authBox").style.display = "none";
  document.getElementById("topTabs").style.display = "block";
  document.getElementById("appMain").style.display = "block";
  document.getElementById("accountUsername").textContent = currentUser.username;
}

function showAuth(){
  document.getElementById("authBox").style.display = "block";
  document.getElementById("topTabs").style.display = "none";
  document.getElementById("appMain").style.display = "none";
  closeTopPanels();
}

/***********************
 * TOP PANELS TOGGLE
 ***********************/
function closeTopPanels(){
  $("#panelAccount").hide();
  $("#panelSettingsTop").hide();
  $("#panelRanking").hide();
  $("#panelHistory").hide();
  $("#panelPerformance").hide();
  $("#tabAccount").removeClass("active");
  $("#tabSettingsTop").removeClass("active");
  $("#tabRanking").removeClass("active");
  $("#tabHistory").removeClass("active");
  $("#tabPerformance").removeClass("active");
}

function toggleTopPanel(which){
  const $acc = $("#panelAccount");
  const $set = $("#panelSettingsTop");
  const $rank = $("#panelRanking");
  const $his = $("#panelHistory");
  const $perf = $("#panelPerformance");

  if(which === "account"){
    const isOpen = $acc.is(":visible");
    closeTopPanels();
    if(!isOpen){
      $acc.show();
      $("#tabAccount").addClass("active");
    }
    return;
  }

  if(which === "settings"){
    const isOpen = $set.is(":visible");
    closeTopPanels();
    if(!isOpen){
      $set.show();
      $("#tabSettingsTop").addClass("active");
    }
    return;
  }

  if(which === "ranking"){
    const isOpen = $rank.is(":visible");
    closeTopPanels();
    if(!isOpen){
      $rank.show();
      $("#tabRanking").addClass("active");
      loadLeaderboard().catch(()=>{});
    }
    return;
  }

  if(which === "history"){
    const isOpen = $his.is(":visible");
    closeTopPanels();
    if(!isOpen){
      $his.show();
      $("#tabHistory").addClass("active");
      loadHistory().catch(()=>{});
    }
    return;
  }

  const isOpen = $perf.is(":visible");
  closeTopPanels();
  if(!isOpen){
    $perf.show();
    $("#tabPerformance").addClass("active");
    loadPerformance().catch(()=>{});
    $("#perfCalendarWrap").hide();
    calendarEnabled = false;
    updateCalendarButtonUI();
  }
}

document.addEventListener("mousedown", function(e){
  const panel = document.getElementById("panelPerformance");
  const tab = document.getElementById("tabPerformance");
  if(!panel || !tab) return;
  if(!$("#panelPerformance").is(":visible")) return;
  if(panel.contains(e.target)) return;
  if(tab.contains(e.target)) return;
  closeTopPanels();
});

/***********************
 * TIMER CORE
 ***********************/
function parseDurationToSeconds(str){
  if(!str) return null;
  str = String(str).trim().toLowerCase();
  if(str === '') return null;

  if(str.includes(':')){
    var parts = str.split(':');
    var h = parseInt(parts[0],10) || 0;
    var m = parseInt(parts[1],10) || 0;
    return (h*60 + m) * 60;
  }

  var hMatch = str.match(/(\d+)\s*h/);
  var mMatch = str.match(/(\d+)\s*m/);
  if(hMatch || mMatch){
    var h = hMatch ? parseInt(hMatch[1],10) : 0;
    var m = mMatch ? parseInt(mMatch[1],10) : 0;
    return (h*60 + m) * 60;
  }

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

function formatHMSUnitsLower(sec){
  sec = Math.max(0, Math.round(sec));
  var h = Math.floor(sec/3600);
  var m = Math.floor((sec - h*3600)/60);
  var s = sec - h*3600 - m*60;
  if(h > 0) return `${h}h${m}m${s}s`;
  if(m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function formatSignedHMSUnitsLower(sec){
  if(sec === null || typeof sec !== "number" || !isFinite(sec)) return "—";
  if(sec === 0) return "0s";
  const sign = sec > 0 ? "+" : "-";
  return sign + formatHMSUnitsLower(Math.abs(sec));
}

var startSeconds,
    totalFocusSeconds = 0,
    sessionsCompleted = 0,
    tickTimer = null;

var currentMode = 'task';
var taskInitialSeconds = null;
var taskCountedSeconds = 0;

var targetEndTime = null;
var lastShownSeconds = null;
var pausedRemainingSeconds = null;

var RADIUS=80, CIRCUMFERENCE=2*Math.PI*RADIUS;

var pausedFocusedSecSnapshot = null;
var pausedRemainingFocusSecSnapshot = null;

function isPaused(){
  return (targetEndTime==null && pausedRemainingSeconds!=null);
}

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

/***********************
 * MINI RINGS
 ***********************/
function setMiniRingProgress(circleId, pct01){
  const c = document.getElementById(circleId);
  if(!c) return;

  const p = Math.max(0, Math.min(1, Number(pct01) || 0));
  const r = parseFloat(c.getAttribute("r") || "0");
  if(!r || !isFinite(r)) return;

  const C = 2 * Math.PI * r;

  c.style.strokeDasharray = `${C}`;
  c.style.strokeDashoffset = `${C * (1 - p)}`;
}

function pctText(p01){
  if(p01 == null || !isFinite(p01)) return "—";
  return `${Math.round(Math.max(0, Math.min(1, p01)) * 100)}%`;
}

/***********************
 * QUOTES
 ***********************/
let quoteInterval = null;

const QUOTES = [
  { text:"La douleur de la discipline est temporaire. Le regret dure une vie.", author:"Jim Rohn" },
  { text:"Fais ce qui est difficile et ta vie deviendra facile. Fais ce qui est facile et ta vie deviendra difficile.", author:"Les Brown" },
  { text:"Le succès n'est pas donné. Il est pris.", author:"David Goggins" },
  { text:"Personne ne viendra te sauver.", author:"" },
  { text:"La version de toi dans 6 mois te regarde. Ne la déçois pas.", author:"" },
  { text:"Le monde ne te doit rien. Arrête d'attendre. Prends.", author:"" },
  { text:"Si c'était facile, tout le monde le ferait. C'est pour ça que tu es seul.", author:"" },
  { text:"Chaque seconde où tu veux abandonner est un test. Passe-le.", author:"David Goggins" },
  { text:"La discipline, c'est faire ce que tu détestes comme si tu l'aimais.", author:"Mike Tyson" },
  { text:"Tu veux une vie que les autres n'ont pas ? Fais ce que les autres ne feront jamais.", author:"" },
  { text:"La souffrance que tu ressens aujourd'hui sera la force que tu ressentiras demain.", author:"Arnold Schwarzenegger" },
  { text:"Un rêve ne devient réalité que par le travail acharné, la détermination et le sacrifice.", author:"Colin Powell" },
  { text:"Tu es exactement là où tu mérites d'être.", author:"" },
  { text:"Tu te donnes à combien de % ?", author:"" },
  { text:"Tu n'es pas là où tu veux être parce que tu ne le mérites pas encore.", author:"" },
  { text:"Bats-toi.", author:"" },
  { text:"La meilleure vengeance est le succès.", author:"" },
  { text:"Garde la foi.", author:"" },
  { text:"Trust the process.", author:"" },
  { text:"Ne prie pas pour une vie facile. Prie pour avoir la force d'en affronter une difficile.", author:"Bruce Lee" },
  { text:"Je n'ai jamais perdu. Soit je gagne, soit j'apprends.", author:"Nelson Mandela" },
  { text:"Tu n'as jamais échoué tant que tu n'abandonnes pas.", author:"" },
  { text:"Quand tu veux abandonner, rappelle-toi pourquoi tu as commencé.", author:"Conor McGregor" },
  { text:"Rappelle-toi de ton Why.", author:"" },
  { text:"La douleur est temporaire. Abandonner dure éternellement.", author:"Lance Armstrong" },
  { text:"Les limites n'existent que si tu les laisses exister.", author:"Kobe Bryant" },
  { text:"Tu peux avoir des résultats ou des excuses. Pas les deux.", author:"Arnold Schwarzenegger" },
  { text:"Ne souhaite pas que ce soit plus facile. Souhaite être meilleur.", author:"Jim Rohn" },
  { text:"Ce n'est pas si tu tombes qui compte. C'est si tu te relèves.", author:"Vince Lombardi" },
  { text:"Si tu traverses l'enfer, continue d'avancer.", author:"Winston Churchill" },
  { text:"Le succès, c'est aller d'échec en échec sans perdre son feu.", author:"Winston Churchill" },
  { text:"Tu rates 100% des tirs que tu ne prends pas.", author:"Wayne Gretzky" },
  { text:"Sois tellement concentré sur tes objectifs que tu n'aies pas le temps de voir ce que font les autres.", author:"Kobe Bryant" },
  { text:"Je ne m'arrête pas quand je suis fatigué. Je m'arrête quand j'ai fini.", author:"David Goggins" },
  { text:"Le succès est la somme de petits efforts, répétés jour après jour.", author:"Robert Collier" },
  { text:"L'échec n'est pas l'opposé du succès. C'est une partie du succès.", author:"Arianna Huffington" },
  { text:"Ce n'est pas le plus fort qui survit, ni le plus intelligent. C'est celui qui s'adapte le mieux au changement.", author:"Charles Darwin" },
  { text:"Concentre-toi sur ce que tu peux contrôler. Ignore le reste.", author:"Tim Ferriss" },
  { text:"Chaque matin, tu as deux choix : continuer à dormir avec tes rêves, ou te réveiller et les poursuivre.", author:"Dwayne Johnson" },
  { text:"Pendant que tu trouves des excuses, quelqu'un d'autre trouve des solutions.", author:"Eric Thomas" },
  { text:"Tu ne peux pas battre quelqu'un qui refuse d'abandonner.", author:"Babe Ruth" },
  { text:"Jamais, jamais, jamais n'abandonne.", author:"" },
  { text:"Tombe sept fois, relève-toi huit.", author:"Proverbe japonais" },
  { text:"Ce ne sera jamais fini tant que tu es toujours là.", author:"" },
  { text:"Travaille en silence. Laisse ton succès faire le bruit.", author:"Frank Ocean" },
  { text:"Chaque jour est une nouvelle chance d'être meilleur qu'hier.", author:"Dwayne Johnson" },
  { text:"Ce que tu fais maintenant définit ce que tu seras demain.", author:"Napoleon Hill" },
  { text:"Ce qui ne me tue pas me rend plus fort.", author:"Friedrich Nietzsche" },
  { text:"Apprends à danser sous la pluie.", author:"Vivian Greene" },
  { text:"On peut briser mon corps, mais jamais mon esprit.", author:"Nelson Mandela" },
  { text:"Après la tempête il y a le beau temps.", author:"" }
];

function setRandomQuote(force){
  const qt = document.getElementById("quoteText");
  const qa = document.getElementById("quoteAuthor");
  if(!qt || !qa) return;

  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)] || {text:"", author:""};
  qt.textContent = q.text ? `“${q.text}”` : "";
  qa.textContent = q.author ? q.author : "";
}

function startQuotesLoop(){
  if(quoteInterval) return;
  setRandomQuote(true);
  quoteInterval = setInterval(()=> setRandomQuote(true), 60000);
}

function stopQuotesLoop(){
  if(quoteInterval){ clearInterval(quoteInterval); quoteInterval = null; }
}

/***********************
 * CONFETTIS + OBJECTIF
 ***********************/
function launchConfetti(){
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  function resize(){
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  const W = () => window.innerWidth;
  const H = () => window.innerHeight;

  const palette = [
    "#FF1744","#F50057","#D500F9","#651FFF","#3D5AFE","#2979FF","#00B0FF","#00E5FF",
    "#1DE9B6","#00E676","#76FF03","#C6FF00","#FFEA00","#FFC400","#FF9100","#FF3D00",
    "#8D6E63","#90A4AE","#FFFFFF","#BDBDBD","#4DD0E1","#BA68C8","#9575CD","#7986CB",
    "#64B5F6","#4FC3F7","#4DB6AC","#81C784","#AED581","#DCE775","#FFF176","#FFD54F"
  ];

  const count = 170;

  const parts = Array.from({ length: count }, (_, i) => {
    const x = W() / 2;
    const y = H() / 2;
    const ang = Math.random() * Math.PI * 2;
    const spd = 6 + Math.random() * 10;
    const color = palette[i % palette.length];

    return {
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - (4 + Math.random() * 4),
      g: 0.26 + Math.random() * 0.18,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.25,
      life: 60 + Math.floor(Math.random() * 35),
      color
    };
  });

  let frame = 0;
  let raf = null;

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  function draw(){
    frame++;
    ctx.clearRect(0, 0, W(), H());

    for(const p of parts){
      if(p.life <= 0) continue;
      p.life--;

      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      p.rot += p.vr;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 45));
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    }

    const alive = parts.some(p => p.life > 0);
    if(alive && frame < 120){
      raf = requestAnimationFrame(draw);
    } else {
      cleanup();
    }
  }

  function cleanup(){
    if(raf) cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    canvas.remove();
  }

  raf = requestAnimationFrame(draw);
}

function triggerGoalExplodeOnce(){
  const day = todayISO();
  if(goalExplodedTodayISO === day) return;

  goalExplodedTodayISO = day;

  const stage = document.querySelector(".rings-stage");
  if(stage){
    stage.classList.remove("goal-explode");
    void stage.offsetWidth;
    stage.classList.add("goal-explode");
  }

  launchConfetti();
}

/***********************
 * TICK
 ***********************/
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
  saveAllIfSecondChanged().catch(()=>{});
}

function tick(){
  if(targetEndTime==null) return;

  var sec=secondsRemainingNow();

  if(lastShownSeconds===null||sec!==lastShownSeconds){
    showClock(sec);
    lastShownSeconds=sec;

    if(currentMode === "task" && sec === 2){
      const key = segmentCueKey("focus_t2");
      if(lastSoundCueKey !== key){
        lastSoundCueKey = key;
        playSound(audioFocus);
      }
    }

    if(currentMode === "break" && sec === 10){
      const key = segmentCueKey("break_t10");
      if(lastSoundCueKey !== key){
        lastSoundCueKey = key;
        playSound(audioBreak);
      }
    }

    if(sec===0) onSegmentEnd();
    updateStatsUI();
    renderFocus();
    renderCompletedMinutes();
  }

  saveAllIfSecondChanged().catch(()=>{});
}

/***********************
 * SAVE EACH SECOND
 ***********************/
async function saveAllIfSecondChanged(){
  if(!currentUser?.id) return;
  const nowSec = Math.floor(Date.now()/1000);
  if(lastSavedEpochSec === nowSec) return;
  lastSavedEpochSec = nowSec;

  await saveTimerState();
  await upsertDailyHistory(currentUser.id);

  if($("#panelPerformance").is(":visible")){
    loadPerformance().catch(()=>{});
    if(calendarEnabled){
      renderCalendar().catch(()=>{});
    }
  }
}

/***********************
 * FOCUS EFFECTIF
 ***********************/
function effectiveFocusSeconds(){
  if(isPaused() && pausedFocusedSecSnapshot!=null){
    return pausedFocusedSecSnapshot;
  }

  var base = totalFocusSeconds;

  if(currentMode==='task' && taskInitialSeconds!=null){
    var remainingForElapsed =
      (targetEndTime==null && pausedRemainingSeconds!=null)
        ? pausedRemainingSeconds
        : secondsRemainingNow();

    if(typeof remainingForElapsed !== 'number') remainingForElapsed = 0;

    var elapsedThisTask = taskInitialSeconds - Math.max(0, remainingForElapsed);
    elapsedThisTask = Math.max(0, elapsedThisTask - taskCountedSeconds);
    base += elapsedThisTask;
  }

  return Math.max(0, base);
}

function isTaskInProgress(){
  return (currentMode==='task' && taskInitialSeconds!=null && (targetEndTime!=null || pausedRemainingSeconds!=null));
}

function sessionsForHistory(){
  if(isTaskInProgress()) return Math.max(1, sessionsCompleted);
  return sessionsCompleted;
}

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

/***********************
 * FIN DE SEGMENT
 ***********************/
function onSegmentEnd(){
  if(targetEndTime==null) return;

  targetEndTime=null;
  pausedRemainingSeconds=null;
  stopTick();
  pausedFocusedSecSnapshot=null;
  pausedRemainingFocusSecSnapshot=null;

  if(currentMode==='task'){
    var rest = Math.max(0, taskInitialSeconds - taskCountedSeconds);
    if(rest > 0){
      totalFocusSeconds += rest;
      taskCountedSeconds = taskInitialSeconds;
    }

    sessionsCompleted += 1;
    renderSessions();

    if(currentUser?.id){
      upsertDailyHistory(currentUser.id).catch(()=>{});
    }

    launchConfetti();

    startNext('break');
  } else {
    startNext('task');
  }

  saveAllIfSecondChanged().catch(()=>{});
}

/***********************
 * PROCHAIN SEGMENT
 ***********************/
function startNext(mode){
  currentMode=mode;
  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  var breakS   = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

  lastSoundCueKey = null;

  if(mode==='task'){
    taskInitialSeconds=sessionS;
    taskCountedSeconds=0;
    startSeconds=taskInitialSeconds;
  } else {
    startSeconds=breakS;
  }

  showClock(startSeconds);
  updateRing(0);

  if($('#perpetual').is(':checked')){
    $('#playPauseButton').attr('class','fa fa-pause fa-stack-1x');
    targetEndTime=Date.now()+startSeconds*1000;
    startTick();
  } else {
    $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  }

  updateStatsUI();
  renderFocus();
  renderCompletedMinutes();

  ensureAutosave();
  saveAllIfSecondChanged().catch(()=>{});
}

/***********************
 * STATS UI
 ***********************/
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

  const plannedSessions = (goalS!=null && sessionS>0) ? Math.max(1, Math.ceil(goalS / sessionS)) : null;

  const goalProg = (goalS!=null) ? (focusedSec / Math.max(1, goalS)) : null;
  const goalProgClamped = (goalProg==null) ? null : Math.max(0, Math.min(1, goalProg));

  document.getElementById("ringRemFocusValue").textContent =
    (remainingFocusSec!=null) ? formatHMSUnitsLower(remainingFocusSec) : "—";
  const remProg = (goalS!=null && remainingFocusSec!=null) ? (1 - (remainingFocusSec / Math.max(1, goalS))) : null;
  const remProgClamped = (remProg==null) ? null : Math.max(0, Math.min(1, remProg));
  document.getElementById("ringRemFocusPct").textContent = pctText(remProgClamped);
  setMiniRingProgress("ringRemFocusProg", remProgClamped ?? 0);

  document.getElementById("ringFocusValue").textContent = formatHMSUnitsLower(focusedSec);
  document.getElementById("ringFocusPct").textContent = pctText(goalProgClamped);
  setMiniRingProgress("ringFocusProg", goalProgClamped ?? 0);

  document.getElementById("ringSessRemValue").textContent =
    (sessionsRemaining!=null) ? String(sessionsRemaining) : "—";
  const sessRemProg = (plannedSessions!=null && sessionsRemaining!=null)
    ? (1 - (sessionsRemaining / Math.max(1, plannedSessions)))
    : null;
  const sessRemProgClamped = (sessRemProg==null) ? null : Math.max(0, Math.min(1, sessRemProg));
  document.getElementById("ringSessRemPct").textContent = pctText(sessRemProgClamped);
  setMiniRingProgress("ringSessRemProg", sessRemProgClamped ?? 0);

  document.getElementById("ringSessionsValue").textContent = String(sessionsCompleted);
  const sessProg = (plannedSessions!=null)
    ? (sessionsCompleted / Math.max(1, plannedSessions))
    : null;
  const sessProgClamped = (sessProg==null) ? null : Math.max(0, Math.min(1, sessProg));
  document.getElementById("ringSessionsPct").textContent = pctText(sessProgClamped);
  setMiniRingProgress("ringSessionsProg", sessProgClamped ?? 0);

  document.getElementById("ringEtaValue").textContent = etaText;
  document.getElementById("ringEtaPct").textContent = pctText(goalProgClamped);
  setMiniRingProgress("ringEtaProg", goalProgClamped ?? 0);

  if(goalS != null && focusedSec >= goalS){
    triggerGoalExplodeOnce();
  }
}

/***********************
 * TIMER_STATE
 ***********************/
function buildStateJSON(){
  return {
    goalTimeInput: $('#goalTimeInput').val(),
    sessionLengthInput: $('#sessionLengthInput').val(),
    breakLengthInput: $('#breakLengthInput').val(),
    perpetual: $('#perpetual').is(':checked'),

    startSeconds,
    totalFocusSeconds,
    sessionsCompleted,
    currentMode,
    taskInitialSeconds,
    taskCountedSeconds,
    targetEndTime,
    pausedRemainingSeconds,

    pausedFocusedSecSnapshot,
    pausedRemainingFocusSecSnapshot,

    endedDayISO,
    endedDayFinalSeconds,
    endedDayFinalSessions,

    goalExplodedTodayISO
  };
}

function applyStateJSON(state){
  if(!state || typeof state !== "object") return;

  if(state.goalTimeInput != null) $('#goalTimeInput').val(state.goalTimeInput);
  if(state.sessionLengthInput != null) $('#sessionLengthInput').val(state.sessionLengthInput);
  if(state.breakLengthInput != null) $('#breakLengthInput').val(state.breakLengthInput);
  if(state.perpetual != null) $('#perpetual').prop('checked', !!state.perpetual);

  startSeconds = state.startSeconds ?? startSeconds;
  totalFocusSeconds = state.totalFocusSeconds ?? totalFocusSeconds;
  sessionsCompleted = state.sessionsCompleted ?? sessionsCompleted;
  currentMode = state.currentMode ?? currentMode;
  taskInitialSeconds = state.taskInitialSeconds ?? taskInitialSeconds;
  taskCountedSeconds = state.taskCountedSeconds ?? taskCountedSeconds;
  targetEndTime = state.targetEndTime ?? targetEndTime;
  pausedRemainingSeconds = state.pausedRemainingSeconds ?? pausedRemainingSeconds;

  pausedFocusedSecSnapshot = state.pausedFocusedSecSnapshot ?? pausedFocusedSecSnapshot;
  pausedRemainingFocusSecSnapshot = state.pausedRemainingFocusSecSnapshot ?? pausedRemainingFocusSecSnapshot;

  endedDayISO = state.endedDayISO ?? endedDayISO;
  endedDayFinalSeconds = state.endedDayFinalSeconds ?? endedDayFinalSeconds;
  endedDayFinalSessions = state.endedDayFinalSessions ?? endedDayFinalSessions;

  goalExplodedTodayISO = state.goalExplodedTodayISO ?? goalExplodedTodayISO;

  renderSessions();
  renderFocus();
  renderCompletedMinutes();
  updateStatsUI();

  if(targetEndTime && typeof targetEndTime === "number"){
    showClock(secondsRemainingNow());
    $('#playPauseButton').attr('class','fa fa-pause fa-stack-1x');
    startTick();
  } else if(pausedRemainingSeconds != null){
    showClock(pausedRemainingSeconds);
    $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  } else {
    const ss = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
    startSeconds = ss;
    showClock(ss);
    updateRing(0);
    $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  }

  ensureAutosave();
}

async function saveTimerState(){
  if(!currentUser?.id) return;

  const payload = {
    user_id: currentUser.id,
    state_json: buildStateJSON()
  };

  const { error } = await db
    .from("timer_state")
    .upsert(payload, { onConflict: "user_id" });

  if(error) console.warn("[timer_state save]", error.message);
}

async function loadTimerState(){
  const { data, error } = await db
    .from("timer_state")
    .select("state_json")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if(error){
    console.warn("[timer_state load]", error.message);
    return;
  }
  if(data && data.state_json){
    applyStateJSON(data.state_json);
  }
}

/***********************
 * FOCUS_HISTORY
 ***********************/
function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function isoDaysAgo(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeFocusSeconds(sec){
  sec = Number(sec || 0);
  if(!isFinite(sec) || sec < 0) return 0;
  return Math.min(sec, 24 * 3600);
}

function mergeDailyRows(rows){
  const map = new Map();

  for(const r of rows || []){
    const day = r.day;
    if(!day) continue;

    const focused = sanitizeFocusSeconds(r.focused_seconds);
    const sessions = Number(r.sessions_completed || 0);

    if(!map.has(day)){
      map.set(day, {
        ...r,
        focused_seconds: focused,
        sessions_completed: sessions
      });
    } else {
      const existing = map.get(day);
      existing.focused_seconds = Math.max(existing.focused_seconds || 0, focused);
      existing.sessions_completed = Math.max(existing.sessions_completed || 0, sessions);
    }
  }

  return Array.from(map.values()).sort((a,b) => b.day.localeCompare(a.day));
}

async function upsertDailyHistory(userId){
  const day = todayISO();

  let focused_seconds = effectiveFocusSeconds();
  let sessions_completed = sessionsForHistory();

  if(endedDayISO === day && endedDayFinalSeconds != null){
    focused_seconds = endedDayFinalSeconds;
    sessions_completed = endedDayFinalSessions || 0;
  }

  try{
    const { error } = await db
      .from("focus_history")
      .upsert(
        [{ user_id: userId, day, focused_seconds, sessions_completed }],
        { onConflict: "user_id,day" }
      );

    if(!error) return;
    console.warn("[focus_history upsert]", error.message);
  } catch(e){
    console.warn("[focus_history upsert exception]", e);
  }

  const { data: existing } = await db
    .from("focus_history")
    .select("id")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();

  if(existing?.id){
    await db.from("focus_history")
      .update({ focused_seconds, sessions_completed })
      .eq("id", existing.id);
  } else {
    await db.from("focus_history")
      .insert([{ user_id: userId, day, focused_seconds, sessions_completed }]);
  }
}

async function loadHistory(){
  if(!currentUser?.id) return;

  const range = ($("#historyRange").val() || "day");

  let q = db
    .from("focus_history")
    .select("day, focused_seconds, sessions_completed")
    .eq("user_id", currentUser.id);

  if(range === "day"){
    q = q.eq("day", todayISO());
  } else if(range === "week"){
    q = q.gte("day", isoDaysAgo(6));
  } else if(range === "month"){
    q = q.gte("day", isoDaysAgo(29));
  } else if(range === "year"){
    q = q.gte("day", isoDaysAgo(364));
  }

  const { data, error } = await q
    .order("day", { ascending:false })
    .limit(366);

  if(error){
    console.warn("[history load]", error.message);
    renderHistory([]);
    return;
  }

  renderHistory(mergeDailyRows(data || []));
}

function renderHistory(rows){
  const wrap = document.getElementById("historyTableWrap");
  if(!wrap) return;

  if(!rows.length){
    wrap.innerHTML = `<div class="muted">Aucune donnée pour le moment.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Focus</th>
          <th>Sessions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.day}</td>
            <td>${formatHMSUnitsLower(sanitizeFocusSeconds(r.focused_seconds))}</td>
            <td>${r.sessions_completed || 0}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/***********************
 * CLASSEMENT
 ***********************/
async function loadLeaderboard(){
  const wrap = document.getElementById("rankingTableWrap");
  if(!wrap) return;

  const range = ($("#rankingRange").val() || "day");

  let q = db
    .from("focus_history")
    .select("user_id, focused_seconds, day, profiles:profiles!focus_history_user_id_fkey(username)");

  if(range === "day"){
    q = q.eq("day", todayISO());
  } else if(range === "week"){
    q = q.gte("day", isoDaysAgo(6));
  } else if(range === "month"){
    q = q.gte("day", isoDaysAgo(29));
  } else if(range === "year"){
    q = q.gte("day", isoDaysAgo(364));
  }

  const { data, error } = await q.limit(5000);

  if(error){
    console.warn("[leaderboard load]", error.message);
    renderLeaderboard([]);
    return;
  }

  const rows = data || [];
  const perUserDay = new Map();

  for(const r of rows){
    const uid = r.user_id;
    if(!uid || !r.day) continue;

    const username = (r.profiles && r.profiles.username) ? r.profiles.username : "—";
    const focused = sanitizeFocusSeconds(r.focused_seconds);
    const key = `${uid}|${r.day}`;

    if(!perUserDay.has(key)){
      perUserDay.set(key, {
        user_id: uid,
        username,
        day: r.day,
        focused_seconds: focused
      });
    } else {
      const existing = perUserDay.get(key);
      existing.focused_seconds = Math.max(existing.focused_seconds || 0, focused);
      if(existing.username === "—" && username !== "—"){
        existing.username = username;
      }
    }
  }

  const map = new Map();

  for(const r of perUserDay.values()){
    if(!map.has(r.user_id)){
      map.set(r.user_id, {
        user_id: r.user_id,
        username: r.username,
        total: r.focused_seconds
      });
    } else {
      map.get(r.user_id).total += r.focused_seconds;
      if(map.get(r.user_id).username === "—" && r.username !== "—"){
        map.get(r.user_id).username = r.username;
      }
    }
  }

  const ranked = Array.from(map.values())
    .filter(x => x.total > 0)
    .sort((a,b) => b.total - a.total)
    .slice(0, 50);

  renderLeaderboard(ranked);
}

function renderLeaderboard(rows){
  const wrap = document.getElementById("rankingTableWrap");
  if(!wrap) return;

  if(!rows.length){
    wrap.innerHTML = `<div class="muted">Aucune donnée pour le moment.</div>`;
    return;
  }

  function rankLabel(i){
    if(i===0) return "👑Top 1 Imperturbable";
    if(i===1) return "🔱Top 2";
    if(i===2) return "⚔️Top 3";
    return `#${i+1}`;
  }

  wrap.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Ranking</th>
          <th>Joueur</th>
          <th>Focus</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r,i) => `
          <tr>
            <td>${rankLabel(i)}</td>
            <td>${r.username}</td>
            <td>${formatHMSUnitsLower(r.total || 0)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/***********************
 * STATS
 ***********************/
let perfRange = "day";
let perfMetric = "focus";
let perfChartType = "line";
let perfCacheRows = null;

let calendarEnabled = false;

let calMonthOffset = 0;
let calClickStart = null;
let calClickEnd = null;
let calPeriods = [];

function periodDaysFor(range){
  if(range==="day") return 1;
  if(range==="week") return 7;
  if(range==="month") return 30;
  if(range==="year") return 365;
  return null;
}

function parseISODate(iso){
  const [y,m,d] = iso.split("-").map(n=>parseInt(n,10));
  return new Date(y, (m-1), d);
}

function formatShortDM(iso){
  const dt = parseISODate(iso);
  const dd = String(dt.getDate()).padStart(2,'0');
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}`;
}

function sumRows(rows, field){
  return rows.reduce((a,r)=>a+(Number(r[field]||0)),0);
}

function pctChange(curr, prev){
  if(prev === 0){
    if(curr === 0) return 0;
    return 100;
  }
  return ((curr - prev) / prev) * 100;
}

function setDeltaBubble(el, pct){
  if(!el) return;
  if(pct === null || typeof pct !== "number" || !isFinite(pct) || pct === 0){
    el.textContent = "";
    el.classList.remove("delta-pos","delta-neg");
    return;
  }
  const sign = pct > 0 ? "+" : "";
  el.textContent = `${sign}${Math.round(pct)}%`;
  el.classList.toggle("delta-pos", pct > 0);
  el.classList.toggle("delta-neg", pct < 0);
}

function formatFrenchLongDate(iso){
  const dt = parseISODate(iso);
  const weekday = new Intl.DateTimeFormat("fr-FR", { weekday:"long" }).format(dt);
  const dayNum = dt.getDate();
  const dayStr = (dayNum === 1) ? "1er" : String(dayNum);
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const yyyy = dt.getFullYear();
  return `${weekday} ${dayStr} ${mm} ${yyyy}`;
}

async function fetchPerfRowsIfNeeded(){
  if(!currentUser?.id) return [];
  if(perfCacheRows) return perfCacheRows;

  const { data, error } = await db
    .from("focus_history")
    .select("day, focused_seconds, sessions_completed")
    .eq("user_id", currentUser.id)
    .order("day", { ascending: true })
    .limit(450);

  if(error){
    console.warn("[perf load]", error.message);
    perfCacheRows = [];
    return [];
  }

  perfCacheRows = mergeDailyRows(data || []).reverse();
  return perfCacheRows;
}

function filterRowsForRange(rows, range){
  if(range === "all") return rows;
  const days = periodDaysFor(range);
  const startISO = isoDaysAgo(days-1);
  return rows.filter(r => r.day >= startISO);
}

function filterRowsForPreviousRange(rows, range){
  if(range === "all") return [];
  const days = periodDaysFor(range);
  const startPrev = isoDaysAgo((days*2)-1);
  const endPrev = isoDaysAgo(days);
  return rows.filter(r => r.day >= startPrev && r.day <= endPrev);
}

function hasActiveCalendarPeriods(){
  if(!calendarEnabled) return false;
  return calPeriods.some(p => p.active);
}

function expandPeriodsToDays(periods){
  const set = new Set();
  for(const p of periods){
    if(!p.active) continue;
    const start = parseISODate(p.startISO);
    const end = parseISODate(p.endISO);
    const s = (start <= end) ? start : end;
    const e = (start <= end) ? end : start;
    const cur = new Date(s.getTime());
    while(cur <= e){
      set.add(cur.toISOString().slice(0,10));
      cur.setDate(cur.getDate()+1);
    }
  }
  return Array.from(set.values()).sort();
}

function rowsForCalendarSelection(rowsAll){
  if(!hasActiveCalendarPeriods()) return null;
  const days = expandPeriodsToDays(calPeriods.filter(p=>p.active));
  const map = new Map(rowsAll.map(r => [r.day, r]));
  return days.map(d => map.get(d) || { day:d, focused_seconds:0, sessions_completed:0 });
}

function computeStreak(rows){
  if(!rows || !rows.length) return 0;
  const set = new Set(rows.filter(r => Number(r.focused_seconds || 0) > 0).map(r => r.day));
  let streak = 0;
  for(let i=0; i<500; i++){
    const d = isoDaysAgo(i);
    if(set.has(d)) streak++;
    else break;
  }
  return streak;
}

function computeRecord(rows){
  if(!rows || !rows.length) return { day: "—", value: 0 };
  let best = rows[0];
  for(const r of rows){
    if((r.focused_seconds||0) > (best.focused_seconds||0)) best = r;
  }
  return { day: best.day, value: Number(best.focused_seconds||0) };
}

function drawBarChart(canvas, labels, values){
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0,0,w,h);

  const padL = 36, padR = 10, padT = 12, padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const maxV = Math.max(1, ...values.map(v=>Number(v||0)));
  const n = Math.max(1, values.length);
  const gap = 6;
  const barW = Math.max(6, (innerW - (n-1)*gap) / n);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT+innerH);
  ctx.lineTo(padL+innerW, padT+innerH);
  ctx.stroke();

  ctx.fillStyle = "#22C55E";
  for(let i=0;i<n;i++){
    const v = Number(values[i]||0);
    const bh = (v/maxV) * innerH;
    const x = padL + i*(barW+gap);
    const y = padT + (innerH - bh);
    ctx.fillRect(x, y, barW, bh);
  }

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "10px Varela Round, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = (n <= 10) ? 1 : Math.ceil(n/10);
  for(let i=0;i<n;i+=step){
    const x = padL + i*(barW+gap) + barW/2;
    ctx.fillText(labels[i] || "", x, padT+innerH+6);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(maxV)), 6, padT+6);
}

function drawRoundedLineChart(canvas, labels, values){
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = canvas.clientHeight;
  ctx.clearRect(0,0,w,h);

  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0,0,w,h);

  const padL = 36, padR = 10, padT = 12, padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const maxV = Math.max(1, ...values.map(v=>Number(v||0)));
  const n = Math.max(1, values.length);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT+innerH);
  ctx.lineTo(padL+innerW, padT+innerH);
  ctx.stroke();

  const pts = [];
  for(let i=0;i<n;i++){
    const v = Number(values[i]||0);
    const x = padL + (i/(Math.max(1,n-1))) * innerW;
    const y = padT + innerH - (v/maxV)*innerH;
    pts.push({x,y});
  }

  ctx.strokeStyle = "#22C55E";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if(pts.length){
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=1;i<pts.length;i++){
      const prev = pts[i-1];
      const cur = pts[i];
      const midX = (prev.x + cur.x)/2;
      const midY = (prev.y + cur.y)/2;
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    }
    const last = pts[pts.length-1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "10px Varela Round, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = (n <= 10) ? 1 : Math.ceil(n/10);
  for(let i=0;i<n;i+=step){
    ctx.fillText(labels[i] || "", pts[i].x, padT+innerH+6);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(maxV)), 6, padT+6);
}

async function loadPerformance(){
  if(!currentUser?.id) return;

  const rowsAll = await fetchPerfRowsIfNeeded();

  const calRows = rowsForCalendarSelection(rowsAll);
  const useCalendar = !!calRows;

  const currRows = useCalendar ? calRows : filterRowsForRange(rowsAll, perfRange);
  const prevRows = useCalendar ? [] : filterRowsForPreviousRange(rowsAll, perfRange);

  const totalFocus = sumRows(currRows, "focused_seconds");
  const prevTotalFocus = sumRows(prevRows, "focused_seconds");
  const progPct = (!useCalendar && perfRange !== "all") ? pctChange(totalFocus, prevTotalFocus) : null;

  const daysLen = periodDaysFor(perfRange);
  const denomDays = useCalendar
    ? Math.max(1, currRows.length)
    : (perfRange === "all" ? Math.max(1, currRows.length) : Math.max(1, daysLen));

  const avgFocus = totalFocus / denomDays;

  let avgPct = null;
  if(!useCalendar && perfRange !== "all"){
    const prevAvg = prevTotalFocus / Math.max(1, denomDays);
    avgPct = pctChange(avgFocus, prevAvg);
  }

  const record = computeRecord(currRows.length ? currRows : rowsAll);
  const streak = computeStreak(rowsAll);

  const $t = document.getElementById("perfTotalValue");
  const $tDelta = document.getElementById("perfTotalDelta");
  if($t) $t.textContent = formatHMSUnitsLower(totalFocus);
  setDeltaBubble($tDelta, progPct);

  const $a = document.getElementById("perfAvgValue");
  const $aDelta = document.getElementById("perfAvgDelta");
  if($a) $a.textContent = formatHMSUnitsLower(avgFocus);
  setDeltaBubble($aDelta, avgPct);

  const progSec = (!useCalendar && perfRange !== "all") ? (totalFocus - prevTotalFocus) : null;
  const $pV = document.getElementById("perfProgValue");
  const $pP = document.getElementById("perfProgPct");
  if($pV) $pV.textContent = (progSec==null) ? "—" : `${formatSignedHMSUnitsLower(progSec)} (${formatHMSUnitsLower(totalFocus)} vs ${formatHMSUnitsLower(prevTotalFocus)})`;
  setDeltaBubble($pP, (!useCalendar && perfRange !== "all") ? progPct : null);

  let avgProgSec = null;
  let avgProgPct = null;
  if(!useCalendar && perfRange !== "all"){
    const prevAvg = prevTotalFocus / Math.max(1, denomDays);
    avgProgSec = avgFocus - prevAvg;
    avgProgPct = pctChange(avgFocus, prevAvg);
  }

  const $apV = document.getElementById("perfAvgProgValue");
  const $apP = document.getElementById("perfAvgProgPct");
  if($apV) $apV.textContent = (avgProgSec==null) ? "—" : `${formatSignedHMSUnitsLower(avgProgSec)} (moy: ${formatHMSUnitsLower(avgFocus)})`;
  setDeltaBubble($apP, (!useCalendar && perfRange !== "all") ? avgProgPct : null);

  const $r = document.getElementById("perfRecordValue");
  const $rDelta = document.getElementById("perfRecordDelta");
  if($r){
    $r.textContent = (record.day==="—") ? "—" : `${formatFrenchLongDate(record.day)} • ${formatHMSUnitsLower(record.value)}`;
  }
  setDeltaBubble($rDelta, null);

  const $s = document.getElementById("perfStreakValue");
  const $sDelta = document.getElementById("perfStreakDelta");
  if($s) $s.textContent = `🔥 Streak: ${streak}`;
  setDeltaBubble($sDelta, null);

  let chartLabels = [];
  let chartValues = [];

  if(useCalendar){
    chartLabels = currRows.map(r => formatShortDM(r.day));
    chartValues = currRows.map(r => (perfMetric === "sessions")
      ? Number(r.sessions_completed||0)
      : Number(r.focused_seconds||0)
    );
  } else if(perfRange === "all"){
    const last = rowsAll.slice(Math.max(0, rowsAll.length-30));
    chartLabels = last.map(r => formatShortDM(r.day));
    chartValues = last.map(r => (perfMetric === "sessions")
      ? Number(r.sessions_completed||0)
      : Number(r.focused_seconds||0)
    );
  } else {
    const days = daysLen;
    const map = new Map(currRows.map(r => [r.day, r]));
    for(let i=days-1; i>=0; i--){
      const iso = isoDaysAgo(i);
      chartLabels.push(formatShortDM(iso));
      const row = map.get(iso);
      chartValues.push(
        perfMetric === "sessions"
          ? Number(row?.sessions_completed || 0)
          : Number(row?.focused_seconds || 0)
      );
    }
  }

  const canvas = document.getElementById("perfChart");
  if(perfChartType === "bar") drawBarChart(canvas, chartLabels, chartValues);
  else drawRoundedLineChart(canvas, chartLabels, chartValues);

  if(calendarEnabled){
    renderComparePeriods(rowsAll).catch(()=>{});
  }
}

/***********************
 * CALENDAR UI
 ***********************/
function updateCalendarButtonUI(){
  const btn = document.getElementById("btnToggleCalendar");
  if(!btn) return;
  btn.style.opacity = calendarEnabled ? "1" : "0.9";
}

function monthStartDate(offset){
  const d = new Date();
  d.setDate(1);
  d.setHours(0,0,0,0);
  d.setMonth(d.getMonth() + offset);
  return d;
}

function daysInMonth(dt){
  const d = new Date(dt.getFullYear(), dt.getMonth()+1, 0);
  return d.getDate();
}

function toISO(d){
  const yyyy=d.getFullYear();
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function isoBetween(x,a,b){
  const lo = (a<=b)?a:b;
  const hi = (a<=b)?b:a;
  return x>=lo && x<=hi;
}

function periodLabel(p){
  return `${p.startISO} → ${p.endISO}`;
}

function newPeriod(startISO,endISO){
  return { id: "p_"+Math.random().toString(16).slice(2), startISO, endISO, active:true };
}

async function renderCalendar(){
  if(!currentUser?.id) return;
  if(!calendarEnabled) return;

  const rowsAll = await fetchPerfRowsIfNeeded();
  const map = new Map(rowsAll.map(r => [r.day, r]));

  const base = monthStartDate(calMonthOffset);
  const monthName = new Intl.DateTimeFormat("fr-FR", { month:"long", year:"numeric" }).format(base);
  const labelEl = document.getElementById("calMonthLabel");
  if(labelEl) labelEl.textContent = monthName;

  const grid = document.getElementById("calGrid");
  if(!grid) return;

  const dow = ["L","M","M","J","V","S","D"];
  let html = dow.map(x=>`<div class="cal-dow">${x}</div>`).join("");

  const firstDow = (new Date(base.getFullYear(), base.getMonth(), 1).getDay() + 6) % 7;
  const dim = daysInMonth(base);

  const prev = new Date(base.getFullYear(), base.getMonth(), 0);
  const prevDim = prev.getDate();

  const cells = [];
  const activePeriodDays = hasActiveCalendarPeriods()
    ? expandPeriodsToDays(calPeriods.filter(p=>p.active))
    : [];

  for(let i=0;i<42;i++){
    const dayNum = i - firstDow + 1;
    let cellDate = null;
    let isMuted = false;

    if(dayNum < 1){
      cellDate = new Date(base.getFullYear(), base.getMonth()-1, prevDim + dayNum);
      isMuted = true;
    } else if(dayNum > dim){
      cellDate = new Date(base.getFullYear(), base.getMonth()+1, dayNum - dim);
      isMuted = true;
    } else {
      cellDate = new Date(base.getFullYear(), base.getMonth(), dayNum);
    }

    const iso = toISO(cellDate);
    const row = map.get(iso);
    const f = Number(row?.focused_seconds || 0);

    let lvl = "cal-l0";
    if(f > 0 && f <= 1800) lvl = "cal-l1";
    else if(f > 1800 && f <= 2*3600) lvl = "cal-l2";
    else if(f > 2*3600 && f <= 4*3600) lvl = "cal-l3";
    else if(f > 4*3600) lvl = "cal-l4";

    const selected =
      (calClickStart && iso === calClickStart) ||
      (calClickEnd && iso === calClickEnd);

    const inRange =
      (calClickStart && calClickEnd && isoBetween(iso, calClickStart, calClickEnd));

    const inActive = activePeriodDays.includes(iso);

    const cls = [
      "cal-cell",
      isMuted ? "cal-muted" : "",
      selected ? "cal-selected" : "",
      inRange ? "cal-inrange" : "",
      inActive ? "cal-inrange" : ""
    ].join(" ").trim();

    cells.push(`
      <div class="${cls}" data-iso="${iso}" ${isMuted ? 'data-muted="1"' : ''}>
        <div class="cal-daynum">${cellDate.getDate()}<span class="cal-dot ${lvl}"></span></div>
      </div>
    `);
  }

  html += cells.join("");
  grid.innerHTML = html;

  Array.from(grid.querySelectorAll(".cal-cell")).forEach(el=>{
    el.addEventListener("click", ()=>{
      const muted = el.getAttribute("data-muted")==="1";
      if(muted) return;

      const iso = el.getAttribute("data-iso");

      if(!calClickStart){
        calClickStart = iso;
        calClickEnd = null;
      } else if(!calClickEnd){
        calClickEnd = iso;
        calPeriods.push(newPeriod(calClickStart, calClickEnd));
        calClickStart = null;
        calClickEnd = null;
      } else {
        calClickStart = iso;
        calClickEnd = null;
      }

      renderCalendar().catch(()=>{});
      renderPeriodsPills().catch(()=>{});
      loadPerformance().catch(()=>{});
    });
  });

  renderPeriodsPills().catch(()=>{});
}

async function renderPeriodsPills(){
  const wrap = document.getElementById("calPeriodsList");
  if(!wrap) return;

  if(!calendarEnabled){
    wrap.innerHTML = "";
    return;
  }

  if(!calPeriods.length){
    wrap.innerHTML = `<div class="muted">Aucune période sélectionnée.</div>`;
    return;
  }

  wrap.innerHTML = calPeriods.map(p=>{
    const cls = p.active ? "period-pill active" : "period-pill";
    return `
      <div class="${cls}" data-id="${p.id}">
        <span>${periodLabel(p)}</span>
        <span class="pill-x" data-x="${p.id}">×</span>
      </div>
    `;
  }).join("");

  Array.from(wrap.querySelectorAll(".period-pill")).forEach(el=>{
    el.addEventListener("click", (e)=>{
      const id = el.getAttribute("data-id");
      if(e.target && e.target.getAttribute("data-x")){
        calPeriods = calPeriods.filter(x => x.id !== id);
      } else {
        calPeriods = calPeriods.map(x => x.id===id ? ({...x, active: !x.active}) : x);
      }
      renderCalendar().catch(()=>{});
      renderPeriodsPills().catch(()=>{});
      loadPerformance().catch(()=>{});
    });
  });
}

async function renderComparePeriods(rowsAll){
  const wrap = document.getElementById("calCompareWrap");
  if(!wrap) return;

  if(!calendarEnabled){
    wrap.innerHTML = "";
    return;
  }

  if(!calPeriods.length){
    wrap.innerHTML = "";
    return;
  }

  const map = new Map(rowsAll.map(r => [r.day, r]));
  const active = calPeriods.filter(p=>p.active);

  if(!active.length){
    wrap.innerHTML = `<div class="muted">Aucune période active.</div>`;
    return;
  }

  const rows = active.map(p=>{
    const days = expandPeriodsToDays([p]);
    let focus = 0, sessions = 0;
    for(const d of days){
      const r = map.get(d);
      if(r){
        focus += Number(r.focused_seconds||0);
        sessions += Number(r.sessions_completed||0);
      }
    }
    return { label: periodLabel(p), focus, sessions };
  });

  wrap.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Période</th>
          <th>Focus</th>
          <th>Sessions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${r.label}</td>
            <td>${formatHMSUnitsLower(r.focus)}</td>
            <td>${r.sessions}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/***********************
 * END DAY NON-DESTRUCTIVE
 ***********************/
async function endCurrentDay(){
  if(!currentUser?.id) return;

  const day = todayISO();

  endedDayISO = day;
  endedDayFinalSeconds = effectiveFocusSeconds();
  endedDayFinalSessions = sessionsForHistory();

  await upsertDailyHistory(currentUser.id);

  stopTick();
  targetEndTime = null;
  pausedRemainingSeconds = null;

  pausedFocusedSecSnapshot = null;
  pausedRemainingFocusSecSnapshot = null;

  totalFocusSeconds = 0;
  sessionsCompleted = 0;
  taskCountedSeconds = 0;

  currentMode = "task";
  taskInitialSeconds = null;

  lastSoundCueKey = null;

  $("#playPauseButton").attr("class","fa fa-play fa-stack-1x");

  const sessionS = parseDurationToSeconds($("#sessionLengthInput").val()) || 0;
  startSeconds = sessionS;

  showClock(sessionS);
  updateRing(0);

  renderSessions();
  renderFocus();
  renderCompletedMinutes();
  updateStatsUI();

  perfCacheRows = null;

  await saveTimerState();
  await loadHistory().catch(()=>{});
  await loadLeaderboard().catch(()=>{});
  await loadPerformance().catch(()=>{});

  if(calendarEnabled){
    await renderCalendar().catch(()=>{});
  }
}

/***********************
 * RESET DAY
 ***********************/
async function resetTodayData(){
  if(!currentUser?.id) return;

  const day = todayISO();

  await db
    .from("focus_history")
    .delete()
    .eq("user_id", currentUser.id)
    .eq("day", day);

  endedDayISO = null;
  endedDayFinalSeconds = null;
  endedDayFinalSessions = null;
  goalExplodedTodayISO = null;

  totalFocusSeconds = 0;
  sessionsCompleted = 0;
  taskCountedSeconds = 0;

  pausedFocusedSecSnapshot = null;
  pausedRemainingFocusSecSnapshot = null;

  renderSessions();
  renderFocus();
  renderCompletedMinutes();
  updateStatsUI();

  perfCacheRows = null;

  await saveTimerState();
  await loadHistory();
  await loadLeaderboard().catch(()=>{});
  await loadPerformance().catch(()=>{});

  if(calendarEnabled){
    await renderCalendar().catch(()=>{});
  }
}

/***********************
 * AUTH
 ***********************/
async function signup(){
  const username = ($("#authUsername").val() || "").trim();
  const code = ($("#authCode").val() || "").trim();
  if(!username || !code){ setAuthStatus("❌ Mets un username + un mot de passe."); return; }

  setAuthStatus("Création...");
  const pin_hash = await sha256(code);

  const { error } = await db
    .from("profiles")
    .insert([{ username, pin_hash }]);

  if(error){ setAuthStatus("❌ " + error.message); return; }
  setAuthStatus("🎉 Félicitations, ton compte est prêt, connecte-toi.");
}

async function login(){
  const username = ($("#authUsername").val() || "").trim();
  const code = ($("#authCode").val() || "").trim();
  if(!username || !code){ setAuthStatus("❌ Mets un username + un mot de passe."); return; }

  setAuthStatus("Connexion...");
  const { data, error } = await db
    .from("profiles")
    .select("id, username, pin_hash")
    .eq("username", username)
    .single();

  if(error){ setAuthStatus("❌ Profil introuvable."); return; }

  const pin_hash = await sha256(code);
  if(pin_hash !== data.pin_hash){
    setAuthStatus("❌ Mot de passe incorrect.");
    return;
  }

  currentUser = { id: data.id, username: data.username };
  localStorage.setItem("pomodoro_username", currentUser.username);

  showAfterLogin();

  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 2*3600;
  startSeconds = sessionS;
  showClock(sessionS);
  updateRing(0);

  perfCacheRows = null;

  await loadTimerState();
  await loadHistory();
  await loadLeaderboard().catch(()=>{});
  await loadPerformance().catch(()=>{});

  ensureAutosave();
  await saveAllIfSecondChanged();

  startQuotesLoop();

  setAuthStatus("✅ Connecté.");
}

function logout(){
  currentUser = null;
  stopTick();
  targetEndTime = null;
  pausedRemainingSeconds = null;

  if(autosaveInterval){ clearInterval(autosaveInterval); autosaveInterval = null; }
  lastSavedEpochSec = null;
  perfCacheRows = null;

  calendarEnabled = false;
  calMonthOffset = 0;
  calClickStart = null;
  calClickEnd = null;
  calPeriods = [];

  lastSoundCueKey = null;

  stopQuotesLoop();

  showAuth();
  setAuthStatus("");
}

/***********************
 * AUTOSAVE LOOP
 ***********************/
function ensureAutosave(){
  if(autosaveInterval) return;
  autosaveInterval = setInterval(() => {
    saveAllIfSecondChanged().catch(()=>{});
  }, 250);
}

/***********************
 * INIT + EVENTS
 ***********************/
$(function(){
  $("#btnSignup").on("click", signup);
  $("#btnLogin").on("click", login);

  $("#tabAccount").on("click", function(e){ e.preventDefault(); toggleTopPanel("account"); });
  $("#tabSettingsTop").on("click", function(e){ e.preventDefault(); toggleTopPanel("settings"); });
  $("#tabRanking").on("click", function(e){ e.preventDefault(); toggleTopPanel("ranking"); });
  $("#tabHistory").on("click", function(e){ e.preventDefault(); toggleTopPanel("history"); });
  $("#tabPerformance").on("click", function(e){ e.preventDefault(); toggleTopPanel("performance"); });

  $("#btnCloseStats").on("click", function(){ closeTopPanels(); });

  $("#btnToggleCalendar").on("click", function(){
    calendarEnabled = !calendarEnabled;
    updateCalendarButtonUI();
    if(calendarEnabled){
      $("#perfCalendarWrap").show();
      renderCalendar().catch(()=>{});
    } else {
      $("#perfCalendarWrap").hide();
      loadPerformance().catch(()=>{});
    }
  });

  $("#calPrev").on("click", function(){ calMonthOffset -= 1; renderCalendar().catch(()=>{}); });
  $("#calNext").on("click", function(){ calMonthOffset += 1; renderCalendar().catch(()=>{}); });
  $("#calClear").on("click", function(){
    calMonthOffset = 0;
    calClickStart = null;
    calClickEnd = null;
    calPeriods = [];
    renderCalendar().catch(()=>{});
    loadPerformance().catch(()=>{});
  });

  $("#btnMinimalMode").on("click", function(){
    document.body.classList.toggle("minimal-mode");
  });

  $("#btnLogout").on("click", logout);
  $("#btnSwitchAccount").on("click", function(){ logout(); });

  $("#btnRefreshHistory").on("click", function(){ loadHistory().catch(()=>{}); });
  $("#btnRefreshRanking").on("click", function(){ loadLeaderboard().catch(()=>{}); });

  $("#historyRange").on("change", function(){ loadHistory().catch(()=>{}); });
  $("#rankingRange").on("change", function(){ loadLeaderboard().catch(()=>{}); });

  $("#btnResetDay").on("click", function(){ $("#resetDayModal").modal("show"); });
  $("#btnResetDayConfirm").on("click", async function(){
    $("#resetDayModal").modal("hide");
    try{ await resetTodayData(); } catch(e){ console.warn("[reset day]", e); }
  });

  $("#endDayButton").on("click", function(){
    endCurrentDay().catch(e => console.warn("[end day]", e));
  });

  $(".perf-tab").on("click", function(){
    $(".perf-tab").removeClass("active");
    $(this).addClass("active");
    perfRange = $(this).data("range");
    perfCacheRows = null;
    loadPerformance().catch(()=>{});
  });

  $("#perfMetric").on("change", function(){
    perfMetric = ($(this).val() || "focus");
    loadPerformance().catch(()=>{});
  });

  $("#perfChartType").on("change", function(){
    perfChartType = ($(this).val() || "line");
    loadPerformance().catch(()=>{});
  });

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
    saveAllIfSecondChanged().catch(()=>{});
  });

  document.addEventListener('visibilitychange', hardUpdateFromNow);

  $('#playPauseButton').on('click', function(){
    var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
    var breakS   = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

    if($(this).hasClass('fa-pause')){
      $(this).attr('class','fa fa-play fa-stack-1x');

      var remaining = secondsRemainingNow();
      pausedRemainingSeconds = remaining;
      targetEndTime = null;
      stopTick();

      if(currentMode==='task' && taskInitialSeconds!=null){
        var elapsed = taskInitialSeconds - remaining - taskCountedSeconds;
        if(elapsed > 0){
          taskCountedSeconds += elapsed;
          totalFocusSeconds += elapsed;
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

      ensureAutosave();
      saveAllIfSecondChanged().catch(()=>{});

    } else {
      $(this).attr('class','fa fa-pause fa-stack-1x');

      pausedFocusedSecSnapshot = null;
      pausedRemainingFocusSecSnapshot = null;

      lastSoundCueKey = null;

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

      ensureAutosave();
      saveAllIfSecondChanged().catch(()=>{});
    }
  });

  $('#resetClockButton').on('click', function(){
    stopTick();
    targetEndTime=null;
    startSeconds=null;
    pausedRemainingSeconds=null;

    pausedFocusedSecSnapshot=null;
    pausedRemainingFocusSecSnapshot=null;

    lastSoundCueKey = null;

    $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');

    currentMode='task';
    taskInitialSeconds=null;
    taskCountedSeconds=0;

    var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
    startSeconds = sessionS;

    showClock(sessionS);
    updateRing(0);

    updateStatsUI();
    renderFocus();
    renderCompletedMinutes();

    ensureAutosave();
    saveAllIfSecondChanged().catch(()=>{});
  });

  showAuth();
  setAuthStatus("");
  $('#goalTimeInput').val('10h');
  $('#sessionLengthInput').val('2h');
  $('#breakLengthInput').val('25m');

  $("#historyRange").val("day");
  $("#rankingRange").val("day");

  perfRange = "day";
  perfMetric = "focus";
  perfChartType = "line";
  $(".perf-tab").removeClass("active");
  $(`.perf-tab[data-range="day"]`).addClass("active");
  $("#perfMetric").val("focus");
  $("#perfChartType").val("line");

  calendarEnabled = false;
  $("#perfCalendarWrap").hide();
  updateCalendarButtonUI();

  setMiniRingProgress("ringRemFocusProg", 0);
  setMiniRingProgress("ringFocusProg", 0);
  setMiniRingProgress("ringSessRemProg", 0);
  setMiniRingProgress("ringSessionsProg", 0);
  setMiniRingProgress("ringEtaProg", 0);

  renderSessions();
  renderFocus();
  renderCompletedMinutes();
  updateRing(0);

  setRandomQuote(true);

  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 2*3600;
  startSeconds = sessionS;
  showClock(sessionS);

  $('#perpetual').prop('checked', true);
  updateStatsUI();

  const savedUsername = localStorage.getItem("pomodoro_username");
  if(savedUsername) $("#authUsername").val(savedUsername);
});