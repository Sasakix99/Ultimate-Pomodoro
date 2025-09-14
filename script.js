/* ========= État ========= */
var startSeconds,
    totalFocusMinutes = 0,
    sessionsCompleted = 0,      // 1 session = 1 tâche terminée
    tickTimer = null,
    defaultTaskTime = 30,
    defaultBreakTime = 10;

var currentMode = 'task';       // 'task' | 'break'
var taskInitialSeconds = null;  // durée de la tâche en cours
var taskCountedSeconds = 0;     // secondes de focus déjà ajoutées pour cette tâche

/* Horloge robuste (onglet inactif OK) */
var targetEndTime = null;       // timestamp (ms) de fin de segment
var lastShownSeconds = null;

/* Sons */
var dingTaskEnd  = new Audio("https://files.catbox.moe/86hbuo.mp3");
var dingBreakEnd = new Audio("https://files.catbox.moe/am7eme.mp3");
dingTaskEnd.preload="auto"; dingBreakEnd.preload="auto";
function play(audio){ try{ audio.currentTime=0; audio.play().catch(()=>{});}catch(e){} }

/* ========= Utils ========= */
function stringToSeconds(time){
  var arr=String(time).split(':'),h,m,s;
  if(String(time).indexOf(':')>-1){
    if(arr.length>2){h=+arr[0];m=+arr[1];s=+arr[2]+m*60+h*3600;return s;}
    else{ m=+arr[0]; s=+arr[1]+m*60; return s; } // m:ss
  } else return +time;
}
function displayToSeconds(text){
  // Task/Break affichent des MINUTES pures (nombre). On accepte aussi "H:MM" par sécurité.
  text=String(text).trim();
  if(text.indexOf(':')>-1){ var p=text.split(':'),h=+p[0]||0,m=+p[1]||0; return (h*60+m)*60; }
  return Number(text)*60;
}

var RADIUS=80, CIRCUMFERENCE=2*Math.PI*RADIUS;
function updateRing(p){ p=Math.max(0,Math.min(1,p)); var off=CIRCUMFERENCE*(1-p);
  document.getElementById('ringProgress').setAttribute('stroke-dasharray', CIRCUMFERENCE);
  document.getElementById('ringProgress').setAttribute('stroke-dashoffset', off);
}

function showTime(sec,id){
  var h=Math.floor(sec/3600), m=Math.floor((sec-h*3600)/60), s=sec-h*3600-m*60, t;
  if(id==='clockTime'){
    if(s<10&&m>0)s='0'+s; if(m<10&&h>0)m='0'+m;
    t=(h===0)?(m+':'+s):(h+':'+m+':'+s); if(h===0&&m===0)t=s;
    if(startSeconds){ updateRing(1-(sec/startSeconds)); }
  } else {
    t = Math.round(sec/60); // minutes pures dans Adjust Time
  }
  document.getElementById(id).innerHTML = t;
}

function formatMinutes(mins){ var h=Math.floor(mins/60), m=mins%60; return h? (h+'h '+(m<10?'0':'')+m) : (m+'m'); }
function renderFocus(){ document.getElementById('focusValue').textContent = formatMinutes(totalFocusMinutes); }
function renderSessions(){ document.getElementById('sessionsValue').textContent = String(sessionsCompleted); }
function resetClockDisplay(){ var s=displayToSeconds(document.getElementById('taskTime').innerHTML); showTime(s,'clockTime'); updateRing(0); }

/* ========= Init ========= */
$(function(){
  $('#taskTime').html(defaultTaskTime);
  $('#breakTime').html(defaultBreakTime);
  renderSessions(); renderFocus();
  updateRing(0);
  $('#clockTime').text('00:00'); resetClockDisplay();
  $('#perpetual').prop('checked', true);
  document.addEventListener('visibilitychange', hardUpdateFromNow);
});

/* ========= Tick basé sur l'heure ========= */
function startTick(){ stopTick(); lastShownSeconds=null; tickTimer=setInterval(tick,250); tick(); }
function stopTick(){ if(tickTimer){ clearInterval(tickTimer); tickTimer=null; } }
function secondsRemainingNow(){ if(targetEndTime==null) return 0; var ms=Math.max(0,targetEndTime-Date.now()); return Math.round(ms/1000); }
function hardUpdateFromNow(){ if(targetEndTime==null) return; var sec=secondsRemainingNow(); showTime(sec,'clockTime'); if(sec===0) onSegmentEnd(); }
function tick(){ if(targetEndTime==null) return; var sec=secondsRemainingNow(); if(lastShownSeconds===null||sec!==lastShownSeconds){ showTime(sec,'clockTime'); lastShownSeconds=sec; if(sec===0) onSegmentEnd(); } }

/* ========= Play / Pause ========= */
$('#playPauseButton').click(function(){
  if($(this).hasClass('fa-pause')){
    $(this).attr('class','fa fa-play fa-stack-1x'); stopTick();
    if(currentMode==='task' && taskInitialSeconds!=null && targetEndTime!=null){
      var remaining=secondsRemainingNow();
      var elapsed=taskInitialSeconds-remaining-taskCountedSeconds;
      if(elapsed>0){ taskCountedSeconds+=elapsed; totalFocusMinutes+=Math.round(elapsed/60); renderFocus(); }
    }
  } else {
    $(this).attr('class','fa fa-pause fa-stack-1x');
    if(targetEndTime==null){
      if(currentMode==='task'){
        taskInitialSeconds=displayToSeconds($('#taskTime').html());
        taskCountedSeconds=0; startSeconds=taskInitialSeconds;
      } else { startSeconds=displayToSeconds($('#breakTime').html()); }
      targetEndTime=Date.now()+startSeconds*1000; showTime(startSeconds,'clockTime'); updateRing(0);
    } else {
      var remaining=secondsRemainingNow();
      if(currentMode==='task') startSeconds=taskInitialSeconds;
      targetEndTime=Date.now()+remaining*1000;
    }
    startTick();
  }
});

/* ========= Reset (timer seulement) ========= */
$('#resetClockButton').click(function(){
  stopTick(); targetEndTime=null; startSeconds=null;
  $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  currentMode='task'; taskInitialSeconds=null; taskCountedSeconds=0;
  resetClockDisplay();
});

/* ========= Ajustements ========= */
function updateClockIfIdle(s){ if(targetEndTime==null){ showTime(s,'taskTime'); resetClockDisplay(); } else { showTime(s,'taskTime'); } }
$('#taskTimeUpButton').click(function(){ var s=displayToSeconds($('#taskTime').html()); if(s<7200){ s+=60; showTime(s,'taskTime'); updateClockIfIdle(s);} });
$('#taskTimeDownButton').click(function(){ var s=displayToSeconds($('#taskTime').html()); if(s>60){ s-=60; showTime(s,'taskTime'); updateClockIfIdle(s);} });
$('#taskTimeResetButton').click(function(){ var s=defaultTaskTime*60; $('#taskTime').html(defaultTaskTime); showTime(s,'taskTime'); updateClockIfIdle(s); });
$('#taskPreset60').click(function(){ var s=60*60; showTime(s,'taskTime'); updateClockIfIdle(s); });
$('#taskPreset120').click(function(){ var s=120*60; showTime(s,'taskTime'); updateClockIfIdle(s); });

$('#breakTimeUpButton').click(function(){ var s=displayToSeconds($('#breakTime').html()); if(s<7200){ s+=60; showTime(s,'breakTime'); } });
$('#breakTimeDownButton').click(function(){ var s=displayToSeconds($('#breakTime').html()); if(s>0){ s-=60; showTime(s,'breakTime'); } });
$('#breakTimeResetButton').click(function(){ $('#breakTime').html(defaultBreakTime); });
$('#breakPreset20').click(function(){ showTime(20*60,'breakTime'); });
$('#breakPreset30').click(function(){ showTime(30*60,'breakTime'); });

/* ========= Fin de segment ========= */
function onSegmentEnd(){
  if(targetEndTime==null) return;
  targetEndTime=null; stopTick();

  if(currentMode==='task'){
    var rest=Math.max(0, taskInitialSeconds-taskCountedSeconds);
    if(rest>0){ totalFocusMinutes+=Math.round(rest/60); renderFocus(); taskCountedSeconds=taskInitialSeconds; }
    play(dingTaskEnd);
    sessionsCompleted += 1; renderSessions();
    startNext('break');
  } else {
    play(dingBreakEnd);
    startNext('task');
  }
}

/* ========= Prochain segment ========= */
function startNext(mode){
  currentMode=mode;
  if(mode==='task'){ taskInitialSeconds=displayToSeconds($('#taskTime').html()); taskCountedSeconds=0; startSeconds=taskInitialSeconds; }
  else { startSeconds=displayToSeconds($('#breakTime').html()); }
  showTime(startSeconds,'clockTime'); updateRing(0);

  if($('#perpetual').is(':checked')){
    $('#playPauseButton').attr('class','fa fa-pause fa-stack-1x');
    targetEndTime=Date.now()+startSeconds*1000; startTick();
  } else {
    $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  }
}