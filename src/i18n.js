/**
 * UI text in Korean and English. The language comes from ?lang=, then the
 * saved choice, then the browser languages (Korean if listed first among the
 * two, else English). Static markup carries data-i18n keys that applyStatic()
 * fills; code calls t(key, vars) when it builds text.
 */
export const LANGS = ['ko', 'en'];

const STRINGS = {
  ko: {
    'doc.title': 'Dusk Kart — 액션캠 카트 레이싱',
    'boot': '트랙 준비 중…',
    'boot.nowebgl': '이 브라우저/기기에서 WebGL을 사용할 수 없어 게임을 실행할 수 없습니다.',
    'gl.lost': '그래픽 연결이 끊겼습니다 — 복구를 기다리는 중…',
    'gl.reload': '새로고침',

    'main.tag': '액션캠 시점 카트 레이싱 · Lumen Park',
    'main.mode': '조작 난이도',
    'main.track': '코스',
    'main.weather': '날씨',
    'main.race': '퀵 레이스 <small>AI 5대와 3랩 레이스</small>',
    'main.trial': '타임 트라이얼 <small>혼자 달리며 베스트 랩 + 고스트</small>',
    'main.online': '온라인 대전 <small>서버 없이 P2P로 친구와 레이스</small>',
    'main.settings': '설정',
    'main.help': '조작법',
    'main.lang': 'English',

    'online.title': '온라인 대전',
    'online.name': '닉네임',
    'online.color': '카트 색상',
    'online.room': '방 코드',
    'online.roomPlaceholder': '비워두면 새 방 생성',
    'online.note': '같은 방 코드를 입력한 사람끼리 브라우저 간 직접(WebRTC) 연결됩니다. 매칭은 공개 Nostr 릴레이를 사용하며 게임 서버는 없습니다.',
    'online.join': '입장',
    'online.loading': '불러오는 중…',
    'online.loadFailed': '온라인 모듈을 불러오지 못했습니다 — 네트워크 연결을 확인한 뒤 다시 입장해 보세요.',
    'online.startFailed': '온라인 연결을 시작하지 못했습니다',
    'back': '뒤로',
    'ok': '확인',

    'lobby.title': '로비',
    'lobby.connecting': '연결 중…',
    'lobby.copy': '초대 링크 복사',
    'lobby.start': '레이스 시작',
    'lobby.startBusy': '레이스 시작 (진행 중인 레이스 있음)',
    'lobby.waitHost': '호스트 대기 중',
    'lobby.freeroam': '자유 주행하며 대기',
    'lobby.leave': '나가기',
    'lobby.rejoin': '다시 연결',
    'lobby.rejoinTitle': '상대가 같은 방에 있는데 보이지 않을 때',
    'lobby.diag': '연결 상태',
    'lobby.me': '나',
    'lobby.host': '👑 호스트',
    'lobby.count': '{n}명 접속 중. ',
    'lobby.hostReady': '준비되면 레이스를 시작하세요.',
    'lobby.guestReady': '호스트가 레이스를 시작하면 자동으로 그리드에 섭니다.',
    'lobby.alone': '다른 드라이버를 기다리는 중… 초대 링크를 보내보세요. (혼자서도 시작할 수 있어요)',
    'lobby.netStatus': 'ONLINE · {code} · {n}명',
    'lobby.invite': '초대 링크',
    'lobby.copied': '초대 링크를 복사했습니다',
    'lobby.copiedWeb': '초대 링크를 복사했습니다 — 친구는 웹 버전에서 같은 방으로 들어옵니다',
    'lobby.copyManual': '복사하지 못했습니다 — 아래 링크를 직접 복사하세요',

    'peer.new': '준비', 'peer.connecting': '연결 중', 'peer.connected': '연결됨', 'peer.disconnected': '끊김',
    'peer.failed': '실패', 'peer.closed': '종료', 'peer.unknown': '확인 중',
    'diag.relay': '시그널링 릴레이',
    'diag.relayCount': '{open}/{total} 연결',
    'diag.relayTrying': '연결 시도 중',
    'diag.turn': 'TURN 중계',
    'diag.turnOn': '설정됨',
    'diag.turnOff': '미설정 (직접 연결만 가능)',
    'diag.noPos': '위치 수신 전',
    'diag.silent': '{s}초째 수신 없음',
    'diag.rejected': '거부된 패킷 {n}',
    'diag.error': '오류',
    'diag.ago': '{s}초 전',
    'diag.warnRelay': '시그널링 릴레이(Nostr)에 연결하지 못했습니다. 네트워크나 광고/추적 차단 확장이 wss:// 연결을 막고 있는지 확인하세요.',
    'diag.warnFailed': '상대와 직접 연결(WebRTC)이 실패했습니다. 회사·학교망이나 모바일 데이터처럼 엄격한 NAT에서는 TURN 중계 서버가 필요할 수 있습니다.',
    'diag.warnAlone': '아직 아무도 보이지 않습니다. 상대가 같은 방 코드로 들어왔는데도 계속 혼자라면 방화벽/NAT 때문에 연결이 막혔을 수 있습니다.',
    'net.joinError': '연결 실패 ({err}) — 방화벽/NAT 환경일 수 있습니다.',

    'set.title': '설정',
    'set.camera': '기본 카메라',
    'set.blur': '모션 블러',
    'set.shake': '카메라 흔들림 (0 = 끔)',
    'set.lens': '액션캠 광각 렌즈 왜곡',
    'set.mode': '조작 난이도',
    'set.mode.easy': '쉬움 — 조향·감속·벽 회피 보조',
    'set.mode.normal': '보통 — 조향 한계·스핀 방지',
    'set.mode.real': '리얼 — 보조 없음',
    'set.volume': '음량',
    'set.quality': '그래픽 품질',
    'set.quality.auto': '자동',
    'set.quality.autoNow': '자동 — 지금: {q}',
    'set.quality.lowFull': '낮음 (저사양/모바일)',
    'set.orient': '화면 방향 (휴대폰)',
    'set.orient.landscape': '가로 고정',
    'set.orient.portrait': '세로 고정',
    'set.note': '그래픽 품질 변경은 페이지를 다시 불러와 적용합니다. <b>자동</b>은 레이스 중 프레임을 보고 다음 실행의 품질을 한 단계씩 올리거나 내립니다.<span class="touch-only"> 화면 방향 고정은 전체 화면에서 동작합니다(안드로이드 Chrome). 주행 중 🔄 버튼으로도 바꿀 수 있습니다.</span>',

    'help.title': '조작법',
    'help.gas': '가속',
    'help.brake': '브레이크 (후륜 전용)',
    'help.steer': '조향',
    'help.cam': '카메라 전환',
    'help.reset': '트랙 복귀',
    'help.pause': '일시정지',
    'help.mute': '음소거',
    'help.keys': '주행 중 키 안내 표시/숨기기',
    'help.touch': '터치',
    'help.padRT': '패드 RT', 'help.padLT': '패드 LT', 'help.stick': '왼쪽 스틱', 'help.padY': '패드 Y',
    'help.padBack': '패드 Back', 'help.padStart': '패드 Start',
    'help.touchHow': '화면 왼쪽을 좌우로 드래그해 조향 · 오른쪽 <b>GAS</b>/<b>BRAKE</b>',
    'help.note': '어렵다면 메인 메뉴에서 조작 난이도를 <b>쉬움</b>으로 두세요 — 가속만 누르고 있어도 코너 앞에서 알아서 감속하고 라인을 따라가도록 도와줍니다. 정지 상태에서 브레이크를 길게 누르면 천천히 후진합니다. <b>리얼</b>에서는 렌탈 카트처럼 뒷바퀴에만 브레이크가 있어 코너 안에서 세게 밟으면 뒤가 미끄러지고, 솔리드 액슬이라 저속에서 조향을 과하게 꺾으면 끌리듯 느려집니다.',

    'pause.title': '일시정지',
    'pause.resume': '계속하기',
    'pause.restart': '다시 시작',
    'menu': '메인 메뉴',

    'res.title': '결과',
    'res.titlePos': '결과 — P{p}',
    'res.again': '다시 하기',
    'res.toLobby': '로비로',
    'res.driver': '드라이버',
    'res.time': '기록',
    'res.best': '베스트 랩',
    'res.running': '주행 중',

    'aria.pause': '일시정지',
    'aria.cam': '카메라 전환',
    'aria.orient': '가로/세로 전환',
    'aria.mode': '조작 난이도',
    'aria.track': '코스',
    'aria.weather': '날씨',

    'key.gas': '가속', 'key.brake': '브레이크', 'key.steer': '조향', 'key.cam': '카메라', 'key.reset': '트랙 복귀',
    'key.pause': '일시정지', 'key.hide': '안내 숨기기', 'key.stick': 'L 스틱', 'key.drag': '왼쪽 드래그',
    'key.brakeTouch': '브레이크 · 정지 중 길게 = 후진', 'key.orient': '가로/세로',

    'drive.easy': '쉬움', 'drive.normal': '보통', 'drive.real': '리얼',
    'hint.easy': '처음이라면 추천 — 라인을 따라 조향을 돕고, 코너 앞에서 자동 감속하며, 벽에 가까워지면 밀어냅니다. 익숙해지면 보통으로!',
    'hint.normal': '조향 한계·스핀 방지만 켜진 상태. 속도 조절과 라인은 직접.',
    'hint.real': '보조 없음. 후륜 잠김, 솔리드 액슬 끌림 등 카트 특성을 그대로.',
    'track.lumen': '클럽', 'track.sprint': '스프린트', 'track.tech': '테크니컬', 'track.gp': 'GP', 'track.endurance': '엔듀로',
    'hint.lumen': '864 m · 촘촘한 인필드 코너가 이어지는 기본 코스.',
    'hint.sprint': '471 m · 짧고 빠른 한 바퀴, 무리가 붙어 다니는 코스.',
    'hint.tech': '786 m · S자와 방향 전환이 이어지는 가장 까다로운 코스.',
    'hint.gp': '1.03 km · 공원 북쪽·서쪽을 크게 도는 빠른 코스.',
    'hint.endurance': '1.15 km · 공원 바깥을 크게 도는 가장 긴 고속 코스.',
    'hint.record': ' 내 기록({w}): {t}',
    'hint.trackOnline': ' (온라인은 호스트 코스)',
    'weather.dry': '맑음', 'weather.rain': '비',
    'hint.dry': '마른 노면, 기본 그립.',
    'hint.rain': '그립↓ 제동 거리↑ · 젖은 연석은 특히 미끄러워요 (온라인은 호스트 날씨).',
    'cam.helmet': '헬멧 액션캠', 'cam.chase': '3인칭 체이스', 'cam.far': '3인칭 원거리',
    'cam.helmetFull': '헬멧 액션캠 (1인칭)',
    'orient.auto': '기기 방향 따라가기', 'orient.landscape': '가로', 'orient.portrait': '세로',
    'quality.low': '낮음', 'quality.medium': '보통', 'quality.high': '높음',

    'info.course': '{track} 코스 · {weather}',
    'info.courseHost': '코스: {track} 코스',
    'info.hostPick': ' (호스트 선택)',
    'info.grid': '그리드 {n}번에서 출발합니다{wx}',
    'info.spectate': '관전 중 — 다음 레이스에 참가할 수 있어요{wx}',
    'info.wx': ' · {track} 코스{weather}',
    'info.raceRunning': '레이스 진행 중 — 끝나면 다음 레이스에 참가합니다',
    'info.confirmStart': '아직 레이스 중인 드라이버가 있습니다 — 한 번 더 누르면 새 레이스를 시작합니다',
    'info.allLeft': '레이스 참가자가 모두 나가 로비로 돌아갑니다',
    'info.hostLeftMe': '호스트가 나갔습니다 — 이제 내가 호스트입니다',
    'info.hostLeft': '호스트가 나갔습니다 — 새 호스트로 이어갑니다',
    'info.driverLeft': '드라이버가 나갔습니다',
    'info.rejoinAuto': '아무도 보이지 않아 방에 다시 연결합니다…',
    'info.rejoin': '방에 다시 연결합니다…',
    'info.rejoinFailed': '다시 연결하지 못했습니다',
    'info.relock': '화면 방향 고정이 풀렸습니다 — 🔄 버튼으로 다시 고정하세요',
    'info.orient': '화면 방향: {o}',
    'info.orientNo': '이 브라우저는 화면 방향 고정을 지원하지 않습니다 — 기기를 직접 돌려 주세요',
    'info.mute': '음소거',
    'info.unmute': '소리 켜짐',
    'info.qualityUp': "이 기기는 여유가 있어 다음 실행부터 그래픽 품질을 '{q}'(으)로 올립니다",
    'info.qualityDown': "프레임이 부족해 다음 실행부터 그래픽 품질을 '{q}'(으)로 낮춥니다",
    'info.wrongWay': '역주행!',
    'tag.spectator': '관전 · {name}',
  },
  en: {
    'doc.title': 'Dusk Kart — Action-cam kart racing',
    'boot': 'Preparing the track…',
    'boot.nowebgl': 'WebGL is not available in this browser or on this device, so the game cannot run.',
    'gl.lost': 'Lost the graphics context — waiting for it to come back…',
    'gl.reload': 'Reload',

    'main.tag': 'Action-cam kart racing · Lumen Park',
    'main.mode': 'Control mode',
    'main.track': 'Course',
    'main.weather': 'Weather',
    'main.race': 'Quick Race <small>3 laps against 5 AI karts</small>',
    'main.trial': 'Time Trial <small>Chase your best lap and its ghost</small>',
    'main.online': 'Online Race <small>Race friends peer-to-peer, no server</small>',
    'main.settings': 'Settings',
    'main.help': 'Controls',
    'main.lang': '한국어',

    'online.title': 'Online Race',
    'online.name': 'Nickname',
    'online.color': 'Kart color',
    'online.room': 'Room code',
    'online.roomPlaceholder': 'Leave empty for a new room',
    'online.note': 'Everyone who enters the same room code connects browser to browser (WebRTC). Matchmaking uses public Nostr relays; there is no game server.',
    'online.join': 'Join',
    'online.loading': 'Loading…',
    'online.loadFailed': 'Could not load the online module — check your connection and try joining again.',
    'online.startFailed': 'Could not start the online connection',
    'back': 'Back',
    'ok': 'OK',

    'lobby.title': 'Lobby',
    'lobby.connecting': 'Connecting…',
    'lobby.copy': 'Copy invite link',
    'lobby.start': 'Start race',
    'lobby.startBusy': 'Start race (a race is still running)',
    'lobby.waitHost': 'Waiting for host',
    'lobby.freeroam': 'Free drive while waiting',
    'lobby.leave': 'Leave',
    'lobby.rejoin': 'Reconnect',
    'lobby.rejoinTitle': 'Use this when a friend is in the room but does not show up',
    'lobby.diag': 'Connection status',
    'lobby.me': 'you',
    'lobby.host': '👑 host',
    'lobby.count': '{n} connected. ',
    'lobby.hostReady': 'Start the race when everyone is ready.',
    'lobby.guestReady': 'You will line up on the grid when the host starts the race.',
    'lobby.alone': 'Waiting for other drivers… send them the invite link. (You can also start alone.)',
    'lobby.netStatus': 'ONLINE · {code} · {n}',
    'lobby.invite': 'Invite link',
    'lobby.copied': 'Invite link copied',
    'lobby.copiedWeb': 'Invite link copied — friends join the same room on the web version',
    'lobby.copyManual': 'Could not copy — copy the link below',

    'peer.new': 'new', 'peer.connecting': 'connecting', 'peer.connected': 'connected', 'peer.disconnected': 'disconnected',
    'peer.failed': 'failed', 'peer.closed': 'closed', 'peer.unknown': 'checking',
    'diag.relay': 'Signaling relays',
    'diag.relayCount': '{open}/{total} connected',
    'diag.relayTrying': 'connecting',
    'diag.turn': 'TURN relay',
    'diag.turnOn': 'configured',
    'diag.turnOff': 'not set (direct connections only)',
    'diag.noPos': 'no position yet',
    'diag.silent': 'silent for {s} s',
    'diag.rejected': '{n} packets rejected',
    'diag.error': 'Error',
    'diag.ago': '{s} s ago',
    'diag.warnRelay': 'Could not reach the signaling relays (Nostr). Check your network, and whether an ad/tracker blocker is blocking wss:// connections.',
    'diag.warnFailed': 'The direct (WebRTC) connection to another driver failed. Strict NATs such as office/school networks or mobile data may need a TURN relay server.',
    'diag.warnAlone': 'Nobody has shown up yet. If a friend entered the same room code and you are still alone, a firewall or NAT may be blocking the connection.',
    'net.joinError': 'Connection failed ({err}) — possibly a firewall or NAT.',

    'set.title': 'Settings',
    'set.camera': 'Default camera',
    'set.blur': 'Motion blur',
    'set.shake': 'Camera shake (0 = off)',
    'set.lens': 'Action-cam wide-angle lens distortion',
    'set.mode': 'Control mode',
    'set.mode.easy': 'Easy — steering, braking and wall assists',
    'set.mode.normal': 'Normal — steering limit and spin assist',
    'set.mode.real': 'Real — no assists',
    'set.volume': 'Volume',
    'set.quality': 'Graphics quality',
    'set.quality.auto': 'Auto',
    'set.quality.autoNow': 'Auto — now: {q}',
    'set.quality.lowFull': 'Low (low-end / mobile)',
    'set.orient': 'Screen orientation (phone)',
    'set.orient.landscape': 'Lock landscape',
    'set.orient.portrait': 'Lock portrait',
    'set.note': 'Changing the graphics quality reloads the page. <b>Auto</b> watches the frame rate during races and steps the quality up or down for the next launch.<span class="touch-only"> Orientation lock works in full screen (Android Chrome). You can also switch it with the 🔄 button while driving.</span>',

    'help.title': 'Controls',
    'help.gas': 'Throttle',
    'help.brake': 'Brake (rear wheels only)',
    'help.steer': 'Steer',
    'help.cam': 'Switch camera',
    'help.reset': 'Back to track',
    'help.pause': 'Pause',
    'help.mute': 'Mute',
    'help.keys': 'Show/hide key hints while driving',
    'help.touch': 'Touch',
    'help.padRT': 'pad RT', 'help.padLT': 'pad LT', 'help.stick': 'left stick', 'help.padY': 'pad Y',
    'help.padBack': 'pad Back', 'help.padStart': 'pad Start',
    'help.touchHow': 'Drag left/right on the left half to steer · <b>GAS</b>/<b>BRAKE</b> on the right',
    'help.note': 'Finding it hard? Set the control mode to <b>Easy</b> on the main menu — just hold the throttle and it slows for corners and follows the line for you. Hold the brake while stopped to reverse slowly. In <b>Real</b>, like a rental kart, only the rear wheels brake, so stamping on them mid-corner slides the rear, and the solid rear axle drags if you over-steer at low speed.',

    'pause.title': 'Paused',
    'pause.resume': 'Resume',
    'pause.restart': 'Restart',
    'menu': 'Main menu',

    'res.title': 'Results',
    'res.titlePos': 'Results — P{p}',
    'res.again': 'Race again',
    'res.toLobby': 'Back to lobby',
    'res.driver': 'Driver',
    'res.time': 'Time',
    'res.best': 'Best lap',
    'res.running': 'running',

    'aria.pause': 'Pause',
    'aria.cam': 'Switch camera',
    'aria.orient': 'Switch landscape/portrait',
    'aria.mode': 'Control mode',
    'aria.track': 'Course',
    'aria.weather': 'Weather',

    'key.gas': 'Throttle', 'key.brake': 'Brake', 'key.steer': 'Steer', 'key.cam': 'Camera', 'key.reset': 'Back to track',
    'key.pause': 'Pause', 'key.hide': 'Hide hints', 'key.stick': 'L stick', 'key.drag': 'Left drag',
    'key.brakeTouch': 'Brake · hold when stopped = reverse', 'key.orient': 'Orientation',

    'drive.easy': 'Easy', 'drive.normal': 'Normal', 'drive.real': 'Real',
    'hint.easy': 'Best for a first run — helps you steer along the line, slows for corners and pushes you off the walls. Move to Normal once you are comfortable!',
    'hint.normal': 'Only the steering limit and spin assist are on. Speed and line are up to you.',
    'hint.real': 'No assists. Rear-wheel lock-up, solid-axle drag — the kart as it is.',
    'track.lumen': 'Club', 'track.sprint': 'Sprint', 'track.tech': 'Technical', 'track.gp': 'GP', 'track.endurance': 'Enduro',
    'hint.lumen': '864 m · The original course, a run of tight infield corners.',
    'hint.sprint': '471 m · A short, fast lap where the pack stays close.',
    'hint.tech': '786 m · Esses and direction changes — the trickiest course.',
    'hint.gp': '1.03 km · A fast lap sweeping round the north and west of the park.',
    'hint.endurance': '1.15 km · The longest, fastest course, round the outside of the park.',
    'hint.record': ' Your record ({w}): {t}',
    'hint.trackOnline': ' (online uses the host\'s course)',
    'weather.dry': 'Dry', 'weather.rain': 'Rain',
    'hint.dry': 'Dry track, normal grip.',
    'hint.rain': 'Less grip, longer braking · wet kerbs are extra slippery (online uses the host\'s weather).',
    'cam.helmet': 'Helmet action cam', 'cam.chase': 'Chase cam', 'cam.far': 'Far chase cam',
    'cam.helmetFull': 'Helmet action cam (first person)',
    'orient.auto': 'Follow the device', 'orient.landscape': 'Landscape', 'orient.portrait': 'Portrait',
    'quality.low': 'Low', 'quality.medium': 'Medium', 'quality.high': 'High',

    'info.course': '{track} course · {weather}',
    'info.courseHost': 'Course: {track}',
    'info.hostPick': ' (host\'s pick)',
    'info.grid': 'Starting from grid slot {n}{wx}',
    'info.spectate': 'Spectating — you can join the next race{wx}',
    'info.wx': ' · {track} course{weather}',
    'info.raceRunning': 'A race is running — you will join the next one',
    'info.confirmStart': 'Some drivers are still racing — press again to start a new race',
    'info.allLeft': 'Everyone in the race left — back to the lobby',
    'info.hostLeftMe': 'The host left — you are the host now',
    'info.hostLeft': 'The host left — carrying on with a new host',
    'info.driverLeft': 'A driver left',
    'info.rejoinAuto': 'Nobody showed up — reconnecting to the room…',
    'info.rejoin': 'Reconnecting to the room…',
    'info.rejoinFailed': 'Could not reconnect',
    'info.relock': 'The orientation lock was released — tap 🔄 to lock it again',
    'info.orient': 'Orientation: {o}',
    'info.orientNo': 'This browser cannot lock the orientation — rotate the device instead',
    'info.mute': 'Muted',
    'info.unmute': 'Sound on',
    'info.qualityUp': "This device has headroom: graphics quality goes up to '{q}' from the next launch",
    'info.qualityDown': "Frame rate too low: graphics quality goes down to '{q}' from the next launch",
    'info.wrongWay': 'WRONG WAY!',
    'tag.spectator': 'Spectator · {name}',
  },
};

const LANG_KEY = 'duskkart.lang';

/** Picks the language from a ?lang= value, a saved choice and the browser's language list. */
export function pickLang(param, saved, browserLangs = []) {
  if (LANGS.includes(param)) return param;
  if (LANGS.includes(saved)) return saved;
  for (const l of browserLangs) {
    const base = String(l).toLowerCase().slice(0, 2);
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

let lang = 'en';
if (typeof window !== 'undefined') {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* storage blocked: fall back to the browser language */ }
  lang = pickLang(new URLSearchParams(location.search).get('lang'), saved, navigator.languages || [navigator.language]);
}

export const getLang = () => lang;

/**
 * Saves the choice; the caller reloads so every built string follows.
 * Returns false when storage is blocked (some embedding iframes), so the
 * caller can carry the choice across the reload in ?lang= instead.
 */
export function saveLang(l) {
  if (!LANGS.includes(l)) return false;
  try { localStorage.setItem(LANG_KEY, l); return true; } catch { return false; }
}

/** Text for `key` with {name} placeholders filled from `vars`. */
export function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.ko[key];
  if (s === undefined) throw new Error(`missing UI string: ${key}`);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Fills data-i18n (text), data-i18n-html (markup) and data-i18n-attr ("attr:key;…") in the page. */
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  document.title = t('doc.title');
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    }
  }
}

/** For tests: every key present in both languages. */
export const STRING_KEYS = { ko: Object.keys(STRINGS.ko), en: Object.keys(STRINGS.en) };
