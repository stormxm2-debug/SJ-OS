/**
 * AI 드림팀 연결 가이드 — 앱 안에 보여 주는 내용 (순수 데이터).
 * 명령은 앱이 실행하지 않는다. 사용자가 복사해서 클로드 Code 탭이나 터미널에 붙여넣는다.
 */

export interface GuideCommand {
  id: string
  label: string
  /** 붙여넣을 텍스트 */
  text: string
  /** 설명 */
  note?: string
}

export interface GuideStep {
  id: string
  title: string
  summary: string
  commands: GuideCommand[]
}

export const GUIDE_INTRO =
  '클로드 Code 창 하나에서 코덱스(GPT)와 안티그래비티(제미나이)에게 일을 나눠 맡기는 방법입니다. 클로드 코드가 지휘자이고, 두 AI는 터미널로 불러 결과만 받아 옵니다.'

export const GUIDE_PREREQS: string[] = [
  '클로드 데스크톱 앱 (Code 탭 사용, Claude 유료 구독 필요)',
  'ChatGPT 계정 (코덱스 로그인용)',
  '구글 계정 (안티그래비티 로그인용)',
  'Node.js 18.18 이상 (코덱스 설치에 필요)',
  '세 AI를 모두 연결할 필요는 없습니다. 필요한 것만 따라 하세요.'
]

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'folder',
    title: '0. 작업 폴더 만들기',
    summary: '연결 설정이 이 폴더에 저장됩니다. 바탕화면에 「AI드림팀」 같은 빈 폴더를 만들고, 클로드 Code 탭에서 그 폴더를 엽니다.',
    commands: []
  },
  {
    id: 'check',
    title: '1. 내 컴퓨터 점검',
    summary: '아무것도 바꾸지 않고 설치 상태만 확인합니다. 결과는 아래 체크리스트에 직접 표시하세요.',
    commands: [
      {
        id: 'check-prompt',
        label: '점검 지시문',
        text:
          'AI 드림팀을 연결하기 전에 내 컴퓨터 상태만 점검해 줘. 아무것도 설치하거나 바꾸지 마.\n- 내 운영체제가 윈도우인지 맥인지 알려 줘\n- 아래 명령을 하나씩 실행하고 결과를 표로 정리해 줘\n  node --version\n  npm --version\n  codex --version\n  codex login status\n  agy --version\n- 명령을 찾을 수 없다고 나오면 「설치 안 됨」이라고 적어 줘\n- Node.js가 18.18보다 낮으면 따로 알려 줘\n- 마지막에 내가 다음에 할 일을 순서대로 짧게 알려 줘. 설치 명령은 알려 주기만 하고 실행하지는 마',
        note: '클로드 Code 탭 채팅창에 붙여넣으세요.'
      }
    ]
  },
  {
    id: 'codex',
    title: '2. 코덱스(GPT) 연결',
    summary: 'OpenAI 공식 플러그인을 클로드 Code 탭에 설치합니다. Node.js가 없으면 nodejs.org에서 LTS 버전을 먼저 설치하고 클로드 앱을 껐다 켜세요.',
    commands: [
      { id: 'codex-mkt', label: '플러그인 가게 추가', text: '/plugin marketplace add openai/codex-plugin-cc', note: 'Code 탭 채팅창에 보내세요.' },
      { id: 'codex-install', label: '코덱스 플러그인 설치', text: '/plugin install codex@openai-codex' },
      { id: 'codex-reload', label: '플러그인 다시 불러오기', text: '/reload-plugins' },
      { id: 'codex-setup', label: '준비 상태 확인', text: '/codex:setup' },
      { id: 'codex-npm', label: '직접 설치 (필요할 때만)', text: '!npm install -g @openai/codex', note: '맨 앞의 !는 터미널 명령을 바로 실행하라는 표시입니다.' },
      { id: 'codex-login', label: 'ChatGPT 계정 로그인', text: '!codex login', note: '로그인 화면이 나오면 ChatGPT 계정으로 직접 로그인하세요. 비밀번호는 채팅창에 넣지 마세요.' },
      {
        id: 'codex-test',
        label: '연결 시험',
        text: '터미널에서 codex exec로 코덱스에게 "CODEX_OK라고만 답해"라고 시키고, 돌아온 답을 그대로 보여 줘.',
        note: 'CODEX_OK가 돌아오면 연결 완료입니다.'
      },
      { id: 'codex-review', label: '검토만 (코드 고치지 않음)', text: '/codex:review', note: 'git으로 관리하는 폴더에서 바뀐 내용을 읽기만 하고 검토합니다.' },
      { id: 'codex-rescue', label: '일을 통째로 맡기기', text: '/codex:rescue 할 일', note: '예) /codex:rescue 이 폴더의 소개 문구를 더 짧게 다듬어 줘' },
      { id: 'codex-status', label: '진행 상황 · 결과', text: '/codex:status  ·  /codex:result', note: '맡긴 일의 진행 상황을 보고 끝난 결과를 가져옵니다.' }
    ]
  },
  {
    id: 'agy',
    title: '3. 안티그래비티(제미나이) 연결',
    summary: '구글 공식 명령 도구 agy를 설치하고 한 번 로그인합니다. 설치 후에는 PowerShell(맥은 터미널)을 새로 여세요.',
    commands: [
      { id: 'agy-install-win', label: '설치 (윈도우 PowerShell)', text: 'irm https://antigravity.google/cli/install.ps1 | iex' },
      { id: 'agy-install-mac', label: '설치 (맥 터미널)', text: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
      { id: 'agy-version', label: '설치 확인', text: 'agy --version', note: '숫자가 나오면 설치된 것입니다.' },
      { id: 'agy-login', label: '처음 한 번 실행 · 로그인', text: 'agy', note: '테마와 폴더 신뢰를 고른 뒤 구글 계정으로 로그인합니다. 한 번만 하면 됩니다.' },
      {
        id: 'agy-test',
        label: '연결 시험 (클로드에서)',
        text: '터미널에서 agy -p로 안티그래비티에게 "AGY_OK라고만 답해"라고 시키고, 돌아온 답을 그대로 보여 줘.',
        note: 'AGY_OK가 돌아오면 연결 완료입니다.'
      }
    ]
  },
  {
    id: 'rules',
    title: '4. 팀 규칙 적어 두기',
    summary: '폴더의 CLAUDE.md에 규칙을 적어 두면, 클로드가 이 폴더를 열 때마다 먼저 읽고 맞는 AI를 부릅니다.',
    commands: [
      {
        id: 'rules-prompt',
        label: 'CLAUDE.md 규칙 지시문',
        text:
          '이 폴더의 CLAUDE.md에 아래 규칙을 추가해 줘. 파일이 없으면 새로 만들어 줘.\n\n## AI 드림팀 규칙\n- 너는 지휘자야. 일을 받으면 직접 할지, 다른 AI에게 맡길지 먼저 정해\n- 제미나이가 필요한 일(유튜브 영상 분석, 2차 검토, 구글 관련 조사)은 터미널에서 agy -p "지시" 로 불러\n- GPT가 필요한 일(코드 검토, 이미지 생성, 다른 시각의 의견)은 codex exec "지시" 로 부르거나 /codex:rescue 를 써\n- 명령이 입력을 기다리며 멈추지 않게, 표준 입력을 닫고 실행해\n- 다른 AI의 답은 그대로 옮기지 말고 확인한 뒤 나에게 요약해서 보고해\n- 설치나 로그인이 안 된 AI는 부르지 말고, 직접 하거나 나에게 알려 줘\n- 비밀번호, API 키, 고객 개인정보는 다른 AI에게 보내지 마',
        note: '코덱스나 안티그래비티 중 하나만 붙였어도 그대로 쓸 수 있습니다.'
      }
    ]
  }
]

export const GUIDE_PROMPTS: GuideCommand[] = [
  { id: 'p1', label: '1. 코드 한 번 더 검토 · 코덱스', text: '코덱스한테 방금 만든 코드를 한 번 더 검토시켜 줘. 고칠 점만 목록으로 가져와 줘.' },
  { id: 'p2', label: '2. 고치지 않고 검토만 · 코덱스', text: '/codex:review', note: 'git으로 관리하는 폴더에서 저장하지 않은 바뀐 부분을 검토합니다. 기록이 없는 새 폴더라면 1번을 쓰세요.' },
  { id: 'p3', label: '3. 문구에 맞는 이미지 · GPT', text: '코덱스로 이 문구에 어울리는 이미지를 만들어서 이 폴더에 PNG로 저장해 줘: (문구)' },
  { id: 'p4', label: '4. 유튜브 영상 분석 · 제미나이', text: '안티그래비티로 이 유튜브 영상을 분석해서 핵심만 5줄로 정리해 줘: (영상 주소)' },
  { id: 'p5', label: '5. 문서 2차 검토 · 제미나이', text: '이 제안서를 제미나이로 2차 검토받고, 고칠 점을 원래 문장과 나란히 보여 줘. 바로 고치지는 마.' },
  { id: 'p6', label: '6. 같은 질문, 답 비교 · 코덱스 + 제미나이', text: '같은 질문을 코덱스와 제미나이에게 따로 물어보고, 둘의 답이 다른 부분만 표로 비교해 줘: (질문)' },
  { id: 'p7', label: '7. 반대 입장에서 약점 찾기 · 코덱스', text: '코덱스에게 이 기획안의 약점을 반대 입장에서 찾아 달라고 하고, 네 의견도 덧붙여서 정리해 줘.' },
  { id: 'p8', label: '8. 주제 조사 · 제미나이', text: '제미나이로 (주제)를 조사하게 하고, 출처 주소가 붙은 내용만 남겨서 정리해 줘.' },
  { id: 'p9', label: '9. 반영 전에 확인받기 · 코덱스', text: '코덱스가 제안한 수정은 바로 반영하지 말고, 바뀌는 부분을 먼저 보여 준 다음 내 확인을 받고 반영해 줘.' },
  { id: 'p10', label: '10. 긴 일은 뒤에서 · 코덱스', text: '/codex:rescue --background (맡길 일)', note: '맡겨 두고 다른 일을 하다가 /codex:status로 진행을 보고 /codex:result로 결과를 가져옵니다.' }
]

export const GUIDE_TROUBLE: { q: string; a: string }[] = [
  { q: '/plugin을 입력해도 아무 반응이 없어요', a: '일반 채팅이 아니라 클로드 앱의 Code 탭 채팅창에 입력하세요. 설치 후에는 /reload-plugins를 한 번 보내 주세요.' },
  { q: '/codex:setup이 코덱스가 없다고 해요', a: 'Node.js가 없거나 18.18보다 낮을 수 있습니다. nodejs.org에서 설치한 뒤 클로드 앱을 껐다 켜고 !npm install -g @openai/codex 를 보내세요.' },
  { q: '코덱스가 로그인하라고 해요', a: '!codex login 을 보내 ChatGPT 계정으로 로그인하세요. !codex login status 에서 Logged in using ChatGPT가 나오면 됩니다.' },
  { q: 'agy를 찾을 수 없다고 나와요', a: 'PowerShell과 클로드 앱을 껐다가 다시 켠 뒤 agy --version을 다시 실행해 보세요.' },
  { q: 'agy가 답 없이 멈춰 있어요', a: '처음 한 번 구글 로그인을 하지 않으면 멈춥니다. PowerShell에서 agy를 직접 실행해 로그인을 마친 뒤 다시 시키세요.' },
  { q: '답이 클로드로 안 돌아와요', a: 'agy 1.5.9와 codex-cli 0.160.0 이상에서 정상 동작을 확인했습니다. agy update 로 안티그래비티를, 코덱스는 최신 버전으로 올리세요.' },
  { q: '사용량 한도에 걸렸다고 나와요', a: '코덱스는 ChatGPT 요금제의 한도를 씁니다. 안티그래비티는 agy 화면에서 /usage로 남은 양을 볼 수 있습니다. 한도가 풀릴 때까지는 클로드에게 직접 시키세요.' }
]

export const GUIDE_CAUTIONS: string[] = [
  '로그인은 각 서비스 로그인 화면에서 직접 하세요. 비밀번호, API 키, 고객 개인정보는 채팅창에 붙여넣거나 다른 AI에게 보내지 마세요.',
  '다른 AI의 답도 틀릴 수 있습니다. 클로드가 확인한 뒤 요약하게 하고, 중요한 결정은 직접 확인하세요.',
  '이 가이드는 윈도우 PC 기준입니다. 맥은 안티그래비티 설치 명령만 다르고 나머지 순서는 같습니다.'
]
