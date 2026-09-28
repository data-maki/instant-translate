// Exercise the actual event handlers with deferred API responses, without
// touching a browser or adding a React rendering/test dependency.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = ts.createSourceFile('TranslatorApp.tsx', readFileSync('src/components/TranslatorApp.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['loadSession', 'newSession', 'start', 'cleanup', 'setActiveSessionSynced', 'handleServerEvent', 'renameSessionTitle', 'deleteSessionByName'];
const handlers = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) handlers.set(node.name.text, node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(handlers.size, names.length);
const compiled = ts.transpileModule([...handlers.values()].join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function detail(name) {
  return { session: { name, title: name, source_languages: ['bg', 'en'], target_language: 'en', tokens: [] }, phrases: [{ id: name }] };
}
function harness(active = '') {
  const state = { ActiveSession: active, Status: 'idle', Phrases: [], Error: '', LoadingSession: '' };
  const pending = [];
  const sockets = [];
  const ref = current => ({ current });
  const noop = () => {};
  class Socket {
    static OPEN = 1;
    static CLOSING = 2;
    constructor() { this.readyState = 0; sockets.push(this); }
    send() {}
    close() { this.readyState = 3; }
  }
  const deps = {
    isLive: false, status: 'idle', postProcessing: false, openAIRealtimeEnabled: false,
    activeSession: active, activeSessionTitle: '', activeDurationSeconds: null,
    phrases: [], sourceA: 'bg', sourceB: 'en', sourceALanguages: ['bg'], expectedSpeakerCount: '2',
    userId: 'test-user', contextBundle: { soniox: '' }, DEFAULT_SESSION_PLACE_CONTEXT: {},
    activeSessionRef: ref(active), sessionDetailCacheRef: ref({}), wsRef: ref(null),
    recorderRef: ref(null), audioPlayerRef: ref(null), stopFallbackTimerRef: ref(null),
    realtimeTranscriptBridgeActiveRef: ref(false), sonioxRealtimePhraseCountRef: ref(0),
    adaptationRequestsRef: ref(new Set()), shouldFollowFeedRef: ref(true),
    cancelAutoImprove: noop, clearProviderSignals: noop, clearRealtimeCaptionDrafts: noop,
    resetAdaptations: noop, startDurationTimer: noop, stopDurationTimer: noop,
    resetSpeechQueue: noop, ttsModeRef: ref('push'), warmTtsPlayback: async () => {},
    stopRealtimeSessions: noop, refreshSessions: noop, scheduleAutoImprove: noop,
    stripProfileBlock: x => x, stripRegisterBlock: x => x, durationFromPhrases: () => 0,
    websocketUrl: () => 'ws://test.invalid', WebSocket: Socket,
    fetchSessionDetail: name => { const request = deferred(); pending.push({ name, ...request }); return request.promise; },
    renameSavedSession: () => { const request = deferred(); pending.push(request); return request.promise; },
    deleteSavedSession: () => { const request = deferred(); pending.push(request); return request.promise; },
    require: name => { assert.equal(name, '@/lib/audio'); return { startPcmRecorder: async () => ({ stop: noop }) }; }
  };
  for (const setter of compiled.matchAll(/\b(set[A-Z]\w*)\(/g)) {
    const name = setter[1];
    if (name === 'setActiveSessionSynced') continue;
    deps[name] = value => { const key = name.slice(3); state[key] = typeof value === 'function' ? value(state[key] ?? []) : value; };
  }
  const api = new Function(...Object.keys(deps), `${compiled}\nreturn { ${names.join(',')} };`)(...Object.values(deps));
  return { api, state, refs: deps, pending, sockets };
}

test('a delayed history response cannot replace a newly started recording', async () => {
  const h = harness();
  const loading = h.api.loadSession('older-chat');
  h.api.newSession();
  await h.api.start();
  const socket = h.sockets[0];
  socket.onmessage({ data: JSON.stringify({ type: 'session', session: { name: 'new-recording', title: 'New chat', token_count: 0 } }) });
  h.pending[0].resolve(detail('older-chat'));
  await loading;
  assert.equal(h.state.ActiveSession, 'new-recording');
  assert.equal(h.refs.wsRef.current, socket);
  assert.notEqual(h.state.Status, 'stopped');
  assert.deepEqual(h.state.Phrases, []);
});

test('New chat discards stale load failures as well as successful responses', async () => {
  const h = harness();
  const loading = h.api.loadSession('older-chat');
  h.api.newSession();
  h.pending[0].reject(new Error('old request failed'));
  await loading;
  assert.equal(h.state.ActiveSession, '');
  assert.equal(h.state.Error, '');
});

test('an older load cannot replace a newer choice or clear its loading indicator', async () => {
  const h = harness();
  const older = h.api.loadSession('older-chat');
  const newer = h.api.loadSession('chosen-chat');
  h.pending[0].resolve(detail('older-chat'));
  await older;
  assert.equal(h.state.LoadingSession, 'chosen-chat');
  h.pending[1].resolve(detail('chosen-chat'));
  await newer;
  assert.equal(h.state.ActiveSession, 'chosen-chat');
  assert.equal(h.state.LoadingSession, '');
});

test('a delayed rename cannot rename a different active conversation', async () => {
  const h = harness('older-chat');
  const renaming = h.api.renameSessionTitle('older-chat', 'Renamed old chat');
  h.api.newSession();
  h.api.setActiveSessionSynced('new-recording');
  h.pending[0].resolve({ name: 'older-chat', title: 'Renamed old chat' });
  await renaming;
  assert.equal(h.state.ActiveSession, 'new-recording');
  assert.notEqual(h.state.ActiveSessionTitle, 'Renamed old chat');
});

test('a delayed deletion cannot clear a different active conversation', async () => {
  const h = harness('older-chat');
  const deleting = h.api.deleteSessionByName('older-chat');
  h.api.newSession();
  h.api.setActiveSessionSynced('new-recording');
  h.pending[0].resolve({ name: 'older-chat' });
  await deleting;
  assert.equal(h.state.ActiveSession, 'new-recording');
});

test('a late save updates history without selecting the saved conversation', () => {
  const h = harness('new-recording');
  h.api.handleServerEvent({ type: 'saved', session: 'older-chat', title: 'Old topic', token_count: 10, phrases: [{ id: 'old' }], path: '/old' });
  assert.equal(h.state.ActiveSession, 'new-recording');
  assert.deepEqual(h.state.Phrases, []);
  assert.equal(h.state.Sessions[0].name, 'older-chat');
});

test('the current recording still receives its saved title and transcript', () => {
  const h = harness('current');
  h.api.handleServerEvent({ type: 'saved', session: 'current', title: 'New topic', token_count: 10, phrases: [{ id: 'current' }], path: '/current' });
  assert.equal(h.state.ActiveSession, 'current');
  assert.equal(h.state.ActiveSessionTitle, 'New topic');
  assert.deepEqual(h.state.PhrasesAndFollow, [{ id: 'current' }]);
});

test('events from the previous socket cannot alter a new recording', async () => {
  const h = harness();
  await h.api.start();
  const previous = h.sockets[0];
  h.api.newSession();
  await h.api.start();
  const current = h.sockets[1];
  current.onmessage({ data: JSON.stringify({ type: 'session', session: { name: 'new-recording', token_count: 0 } }) });
  previous.onmessage({ data: JSON.stringify({ type: 'session', session: { name: 'older-chat', token_count: 10 } }) });
  previous.onclose();
  assert.equal(h.state.ActiveSession, 'new-recording');
  assert.equal(h.refs.wsRef.current, current);
});
