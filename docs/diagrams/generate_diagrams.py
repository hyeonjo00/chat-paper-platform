import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import matplotlib.font_manager as fm
import os

OUT = os.path.dirname(os.path.abspath(__file__))

# Korean font setup
plt.rcParams['font.family'] = 'Malgun Gothic'
plt.rcParams['axes.unicode_minus'] = False

# ── Color palette ──────────────────────────────────────────────────────────
BG      = '#0f1117'
SURFACE = '#1a1d2e'
CARD    = '#252840'
BORDER  = '#3d4268'
ACCENT  = '#6c63ff'
GREEN   = '#22c55e'
RED     = '#ef4444'
YELLOW  = '#f59e0b'
CYAN    = '#06b6d4'
TEXT    = '#e2e8f0'
MUTED   = '#94a3b8'

def fig(w=14, h=10):
    f = plt.figure(figsize=(w, h), facecolor=BG)
    f.patch.set_alpha(1)
    return f

def ax_clean(f):
    a = f.add_subplot(111)
    a.set_facecolor(BG)
    a.axis('off')
    return a

def box(ax, x, y, w, h, label, sub=None, color=CARD, border=BORDER,
        fontsize=11, subsize=9, radius=0.015):
    rect = FancyBboxPatch((x, y), w, h,
                           boxstyle=f"round,pad=0.005,rounding_size={radius}",
                           linewidth=1.5, edgecolor=border, facecolor=color,
                           transform=ax.transAxes, zorder=3)
    ax.add_patch(rect)
    cy = y + h / 2 + (0.012 if sub else 0)
    ax.text(x + w / 2, cy, label, ha='center', va='center',
            color=TEXT, fontsize=fontsize, fontweight='bold',
            transform=ax.transAxes, zorder=4)
    if sub:
        ax.text(x + w / 2, y + h / 2 - 0.020, sub, ha='center', va='center',
                color=MUTED, fontsize=subsize,
                transform=ax.transAxes, zorder=4)

def arrow(ax, x1, y1, x2, y2, color=MUTED, lw=1.5, label=None, lfs=8):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                xycoords='axes fraction', textcoords='axes fraction',
                arrowprops=dict(arrowstyle='->', color=color,
                                lw=lw, connectionstyle='arc3,rad=0'))
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ax.text(mx + 0.01, my, label, color=color, fontsize=lfs,
                transform=ax.transAxes, zorder=5)

def title(ax, text):
    ax.text(0.5, 0.97, text, ha='center', va='top', color=TEXT,
            fontsize=15, fontweight='bold', transform=ax.transAxes)

# ══════════════════════════════════════════════════════════════════════════════
# 1. system-layered-overview.png
# ══════════════════════════════════════════════════════════════════════════════
def make_system_layered_overview():
    f = fig(14, 9)
    ax = ax_clean(f)
    title(ax, '시스템 계층 구조 (System Layer Overview)')

    layers = [
        (0.1, 0.75, 0.80, 0.12, '① 클라이언트 레이어', 'Browser / Mobile  ·  Next.js React UI', ACCENT),
        (0.1, 0.59, 0.80, 0.12, '② API 레이어', '/api/upload  /api/analyze  /api/jobs/[id]  /api/papers/[id]', '#1e40af'),
        (0.1, 0.43, 0.80, 0.12, '③ 데이터 레이어', 'PostgreSQL (Prisma)  ·  Redis (BullMQ + Rate-Limit)', '#064e3b'),
        (0.1, 0.27, 0.80, 0.12, '④ 워커 레이어', 'Node.js Worker  ·  processPaperJob()  ·  chunker + promptPipeline', '#78350f'),
        (0.1, 0.11, 0.80, 0.12, '⑤ 외부 서비스', 'OpenAI GPT-4o-mini  ·  Fly.io (호스팅)', '#1e1b4b'),
    ]

    for (x, y, w, h, lbl, sub, clr) in layers:
        box(ax, x, y, w, h, lbl, sub, color=clr, border=clr,
            fontsize=13, subsize=10)

    for i in range(len(layers) - 1):
        _, y1, _, h1, *_ = layers[i]
        _, y2, _, h2, *_ = layers[i + 1]
        ax.annotate('', xy=(0.5, y2 + h2), xytext=(0.5, y1),
                    xycoords='axes fraction', textcoords='axes fraction',
                    arrowprops=dict(arrowstyle='->', color=MUTED, lw=2))

    plt.tight_layout(pad=1)
    f.savefig(os.path.join(OUT, 'system-layered-overview.png'), dpi=150, bbox_inches='tight')
    plt.close(f)
    print('OK system-layered-overview.png')

# ══════════════════════════════════════════════════════════════════════════════
# 2. rate-limiting-tiers.png
# ══════════════════════════════════════════════════════════════════════════════
def make_rate_limiting_tiers():
    f = fig(14, 9)
    ax = ax_clean(f)
    title(ax, '다단계 속도 제한 구조 (Rate-Limiting Tiers)')

    tiers = [
        (0.05, 0.68, 0.27, 0.20, 'Layer 1\nIP 프리플라이트',
         'Redis Lua\n30회/60초 per IP\nDB 접근 전 차단', ACCENT),
        (0.37, 0.68, 0.27, 0.20, 'Layer 2\n라우트 수준',
         'Redis Lua (IP + 게스트)\n업로드 IP 8/분  게스트 6/분\n분석  IP 6/분  게스트 4/분', CYAN),
        (0.69, 0.68, 0.27, 0.20, 'Layer 3\n일일 할당량',
         'PostgreSQL Serializable TX\n업로드 20/일\n작업 동시2개 · 일일10개', GREEN),
    ]
    for (x, y, w, h, lbl, sub, clr) in tiers:
        box(ax, x, y, w, h, lbl, sub, color=clr, border=clr,
            fontsize=12, subsize=9)

    # fail arrows → 429
    box(ax, 0.37, 0.30, 0.27, 0.14, '429 Too Many Requests',
        'IP / 게스트 한도 초과', color=RED, border=RED, fontsize=12, subsize=9)

    for cx in [0.185, 0.505, 0.825]:
        arrow(ax, cx, 0.68, 0.505, 0.44, color=RED, label='FAIL')

    # pass flow
    box(ax, 0.37, 0.10, 0.27, 0.12, '✓ DB 접근 허용',
        'getGuestUser() → prisma.user.upsert', color=GREEN, border=GREEN,
        fontsize=12, subsize=9)
    arrow(ax, 0.505, 0.68, 0.505, 0.22, color=GREEN, label='PASS')
    arrow(ax, 0.505, 0.22, 0.505, 0.22, color=GREEN)

    ax.text(0.5, 0.56, '핵심: Layer 1 → 2 통과 후에만 DB 쓰기 가능 → 공격자가 DB 과부하 불가',
            ha='center', color=YELLOW, fontsize=10, style='italic',
            transform=ax.transAxes)

    plt.tight_layout(pad=1)
    f.savefig(os.path.join(OUT, 'rate-limiting-tiers.png'), dpi=150, bbox_inches='tight')
    plt.close(f)
    print('OK rate-limiting-tiers.png')

# ══════════════════════════════════════════════════════════════════════════════
# 3. system-architecture.png
# ══════════════════════════════════════════════════════════════════════════════
def make_system_architecture():
    f = fig(16, 11)
    ax = ax_clean(f)
    title(ax, '전체 시스템 아키텍처 (Full System Architecture)')

    # Browser
    box(ax, 0.38, 0.86, 0.24, 0.08, '브라우저 / 모바일',
        'HTTPS', color=ACCENT, border=ACCENT)

    # Next.js API
    box(ax, 0.10, 0.66, 0.80, 0.14, 'Next.js API 레이어 (Fly.io)',
        '/api/upload   /api/analyze   /api/jobs/[id]   /api/papers/[id]',
        color='#1e3a5f', border=CYAN)

    # PG
    box(ax, 0.05, 0.38, 0.32, 0.20, 'PostgreSQL',
        'User / Upload\nParsedMessage\nPaper / Job / JobLog', color='#0c4a6e', border=CYAN)

    # Redis
    box(ax, 0.42, 0.38, 0.32, 0.20, 'Redis (BullMQ)',
        'paper-generation 큐\n속도 제한 카운터\npreflight:ip:* 키', color='#450a0a', border=RED)

    # Worker
    box(ax, 0.63, 0.10, 0.32, 0.22, 'Worker (Node.js)',
        'processPaperJob()\nchunker → promptPipeline\nOpenAI GPT-4o-mini', color='#1c1917', border=YELLOW)

    # OpenAI
    box(ax, 0.05, 0.10, 0.32, 0.12, 'OpenAI GPT-4o-mini',
        'LLM 호출 (최대 11회/작업)', color='#064e3b', border=GREEN)

    arrows = [
        (0.50, 0.86, 0.50, 0.80, MUTED, 'HTTPS'),
        (0.30, 0.66, 0.21, 0.58, CYAN, 'Prisma TX'),
        (0.55, 0.66, 0.58, 0.58, RED, 'ioredis'),
        (0.58, 0.38, 0.75, 0.32, YELLOW, 'Worker.process()'),
        (0.63, 0.21, 0.37, 0.18, GREEN, '원자적 저장'),
        (0.68, 0.10, 0.37, 0.16, GREEN, 'OpenAI 호출'),
    ]
    for (x1, y1, x2, y2, c, lbl) in arrows:
        arrow(ax, x1, y1, x2, y2, color=c, label=lbl)

    plt.tight_layout(pad=1)
    f.savefig(os.path.join(OUT, 'system-architecture.png'), dpi=150, bbox_inches='tight')
    plt.close(f)
    print('OK system-architecture.png')

# ══════════════════════════════════════════════════════════════════════════════
# 4. queue-processing-flow.png
# ══════════════════════════════════════════════════════════════════════════════
def make_queue_processing_flow():
    f = fig(12, 14)
    ax = ax_clean(f)
    title(ax, '큐 처리 흐름 (Queue Processing Flow)')

    steps = [
        (0.30, 0.88, 0.40, 0.07, 'POST /api/analyze', None, ACCENT),
        (0.30, 0.76, 0.40, 0.07, 'IP 프리플라이트 검사', 'Redis Lua · 30회/60초', '#1e40af'),
        (0.30, 0.64, 0.40, 0.07, '라우트 속도 제한', '쿠키 키 (IP + 게스트)', '#1e40af'),
        (0.30, 0.52, 0.40, 0.07, 'Serializable 트랜잭션', 'Paper + Job 생성', '#064e3b'),
        (0.30, 0.40, 0.40, 0.07, 'queue.add(jobId=SHA256)', 'Redis BullMQ enqueue', '#78350f'),
        (0.30, 0.28, 0.40, 0.07, '200 OK', '{ jobId, paperId }', GREEN),
        (0.30, 0.16, 0.40, 0.07, 'BullMQ → 워커 디스패치', 'Worker.process()', YELLOW),
        (0.30, 0.04, 0.40, 0.07, 'Paper status = COMPLETED', None, GREEN),
    ]

    for (x, y, w, h, lbl, sub, clr) in steps:
        box(ax, x, y, w, h, lbl, sub, color=clr, border=clr)

    fail_cases = [
        (0.70, 0.795, 'FAIL → 429', RED),
        (0.70, 0.675, 'FAIL → 429', RED),
    ]
    tx_fails = [
        (0.78, 0.565, '할당량 초과 → 429', RED),
        (0.78, 0.545, 'P2002 → 기존 작업', YELLOW),
        (0.78, 0.525, 'P2034 → 409', YELLOW),
    ]

    for i in range(len(steps) - 1):
        _, y1, _, h1, *_ = steps[i]
        _, y2, _, h2, *_ = steps[i + 1]
        arrow(ax, 0.50, y1, 0.50, y2 + h2, color=MUTED)

    for (fx, fy, lbl, clr) in fail_cases:
        ax.text(fx, fy, lbl, color=clr, fontsize=9,
                transform=ax.transAxes, fontweight='bold')

    for (fx, fy, lbl, clr) in tx_fails:
        ax.text(fx, fy, lbl, color=clr, fontsize=8.5,
                transform=ax.transAxes)

    plt.tight_layout(pad=1)
    f.savefig(os.path.join(OUT, 'queue-processing-flow.png'), dpi=150, bbox_inches='tight')
    plt.close(f)
    print('OK queue-processing-flow.png')

# ══════════════════════════════════════════════════════════════════════════════
# 5. worker-execution-flow.png
# ══════════════════════════════════════════════════════════════════════════════
def make_worker_execution_flow():
    f = fig(13, 14)
    ax = ax_clean(f)
    title(ax, '워커 실행 흐름 (Worker Execution Flow)')

    steps = [
        (0.28, 0.88, 0.44, 0.07, 'BullMQ 작업 디스패치', None, ACCENT),
        (0.28, 0.77, 0.44, 0.07, 'runWithHardDeadline + AbortController', None, '#1e40af'),
        (0.28, 0.66, 0.44, 0.07, 'markJobProcessing', 'PENDING → PROCESSING', '#064e3b'),
        (0.28, 0.55, 0.44, 0.07, 'ParsedMessages 로드', 'DB에서 조회', '#374151'),
        (0.28, 0.44, 0.44, 0.07, 'chunkMessages()', '최대 3개 청크 분할', '#78350f'),
        (0.28, 0.33, 0.44, 0.08, 'Promise.all() 병렬 실행',
         'analyseRelationship()  +  summariseChunk×N (직렬)', '#1c1917'),
        (0.28, 0.22, 0.44, 0.07, '논문 섹션 생성 배치 1',
         'title + abstract + introduction (병렬)', '#1e3a5f'),
        (0.28, 0.11, 0.44, 0.07, '논문 섹션 생성 배치 2',
         'methods + results + discussion + conclusion (병렬)', '#1e3a5f'),
        (0.28, 0.01, 0.44, 0.07, '원자적 트랜잭션: COMPLETED', 'Paper + Job 저장', GREEN),
    ]

    for (x, y, w, h, lbl, sub, clr) in steps:
        box(ax, x, y, w, h, lbl, sub, color=clr, border=clr)

    for i in range(len(steps) - 1):
        _, y1, _, h1, *_ = steps[i]
        _, y2, _, h2, *_ = steps[i + 1]
        arrow(ax, 0.50, y1, 0.50, y2 + h2, color=MUTED)

    plt.tight_layout(pad=1)
    f.savefig(os.path.join(OUT, 'worker-execution-flow.png'), dpi=150, bbox_inches='tight')
    plt.close(f)
    print('OK worker-execution-flow.png')

# ══════════════════════════════════════════════════════════════════════════════
# 6. retry-backoff-loop.png
# ══════════════════════════════════════════════════════════════════════════════
def make_retry_backoff_loop():
    f = fig(14, 13)
    ax = ax_clean(f)
    title(ax, '재시도 및 백오프 루프 (Retry & Backoff Loop)')

    steps = [
        (0.28, 0.86, 0.44, 0.07, 'callWithRetry(fn, maxRetries=5)', None, ACCENT),
        (0.28, 0.75, 0.44, 0.07, 'parentSignal 중단됨?', None, '#374151'),
        (0.28, 0.64, 0.44, 0.07, '90초 요청 AbortController 생성', None, '#1e40af'),
        (0.28, 0.53, 0.44, 0.07, 'await fn(controller.signal)', None, '#064e3b'),
        (0.28, 0.42, 0.44, 0.07, '오류 분류', '4xx · AbortError · 429 · 5xx · 네트워크', '#78350f'),
        (0.28, 0.31, 0.44, 0.07, 'i == maxRetries-1?', None, '#374151'),
        (0.28, 0.20, 0.44, 0.07, '백오프 계산',
         '429: retry-after×1000+500ms  |  기타: 1000×2^i + jitter', '#1c1917'),
        (0.28, 0.09, 0.44, 0.07, 'sleep(delay, parentSignal)', '중단 가능한 대기', '#1e40af'),
    ]

    for (x, y, w, h, lbl, sub, clr) in steps:
        box(ax, x, y, w, h, lbl, sub, color=clr, border=clr)

    for i in range(len(steps) - 1):
        _, y1, _, h1, *_ = steps[i]
        _, y2, _, h2, *_ = steps[i + 1]
        arrow(ax, 0.50, y1, 0.50, y2 + h2, color=MUTED)

    # side exits
    exits = [
        (0.72, 0.785, 'YES → throw "Job aborted"', RED),
        (0.72, 0.565, 'SUCCESS → 결과 반환', GREEN),
        (0.72, 0.475, '4xx → 즉시 throw', RED),
        (0.72, 0.345, 'YES → throw (재시도 소진)', RED),
    ]
    for (fx, fy, lbl, clr) in exits:
        ax.text(fx, fy, lbl, color=clr, fontsize=9,
                transform=ax.transAxes, fontweight='bold')

    # loop back arrow (i++)
    ax.annotate('', xy=(0.28, 0.13), xytext=(0.10, 0.13),
                xycoords='axes fraction', textcoords='axes fraction',
                arrowprops=dict(arrowstyle='->', color=CYAN, lw=1.5))
    ax.annotate('', xy=(0.10, 0.57), xytext=(0.10, 0.13),
                xycoords='axes fraction', textcoords='axes fraction',
                arrowprops=dict(arrowstyle='->', color=CYAN, lw=1.5))
    ax.annotate('', xy=(0.28, 0.57), xytext=(0.10, 0.57),
                xycoords='axes fraction', textcoords='axes fraction',
                arrowprops=dict(arrowstyle='->', color=CYAN, lw=1.5))
    ax.text(0.03, 0.38, 'i++\n루프\n반복', color=CYAN, fontsize=9,
            ha='center', transform=ax.transAxes)

    plt.tight_layout(pad=1)
    f.savefig(os.path.join(OUT, 'retry-backoff-loop.png'), dpi=150, bbox_inches='tight')
    plt.close(f)
    print('OK retry-backoff-loop.png')

# ══════════════════════════════════════════════════════════════════════════════
# 7. job-recovery-flow.png
# ══════════════════════════════════════════════════════════════════════════════
def make_job_recovery_flow():
    f = fig(16, 10)
    ax = ax_clean(f)
    title(ax, '작업 복구 흐름 (Job Recovery Flow)')

    # Timer
    box(ax, 0.35, 0.84, 0.30, 0.09, '복구 타이머 (5분마다)', None, ACCENT, border=ACCENT)

    # 3 paths
    paths = [
        (0.05, 0.62, 0.24, 0.14, '경로 1\nPROCESSING 고착',
         'startedAt < now-12분', '#1e3a5f'),
        (0.38, 0.62, 0.24, 0.14, '경로 2\nPENDING 고착',
         'enqueuedAt < now-30분', '#1e3a5f'),
        (0.72, 0.62, 0.24, 0.14, '경로 3\n로그 정리',
         '7일 이상 된 JobLog', '#374151'),
    ]
    for (x, y, w, h, lbl, sub, clr) in paths:
        box(ax, x, y, w, h, lbl, sub, color=clr, border=clr)

    arrow(ax, 0.50, 0.84, 0.17, 0.76, color=MUTED)
    arrow(ax, 0.50, 0.84, 0.50, 0.76, color=MUTED)
    arrow(ax, 0.50, 0.84, 0.84, 0.76, color=MUTED)

    # Path 1 sub-steps
    box(ax, 0.05, 0.44, 0.24, 0.10, '잔여 시도 없음?', None, '#374151', border=BORDER)
    arrow(ax, 0.17, 0.62, 0.17, 0.54, color=MUTED)

    box(ax, 0.01, 0.28, 0.13, 0.09, 'FAILED\n마킹', None, RED, border=RED, fontsize=10)
    box(ax, 0.15, 0.28, 0.13, 0.09, 'queue.add\n재큐잉', None, GREEN, border=GREEN, fontsize=10)
    arrow(ax, 0.12, 0.44, 0.07, 0.37, color=RED, label='YES')
    arrow(ax, 0.22, 0.44, 0.21, 0.37, color=GREEN, label='NO')

    # Path 2 sub-steps
    box(ax, 0.38, 0.44, 0.24, 0.10, 'Redis에 존재?', None, '#374151', border=BORDER)
    arrow(ax, 0.50, 0.62, 0.50, 0.54, color=MUTED)
    box(ax, 0.38, 0.28, 0.10, 0.09, '건너뜀', None, '#374151', border=BORDER, fontsize=10)
    box(ax, 0.52, 0.28, 0.10, 0.09, 'queue.add\n재큐잉', None, GREEN, border=GREEN, fontsize=10)
    arrow(ax, 0.45, 0.44, 0.43, 0.37, color=YELLOW, label='YES')
    arrow(ax, 0.55, 0.44, 0.57, 0.37, color=GREEN, label='NO')

    # Path 3 sub-steps
    box(ax, 0.72, 0.44, 0.24, 0.10, 'deleteMany\n오래된 로그', None, '#374151', border=BORDER)
    arrow(ax, 0.84, 0.62, 0.84, 0.54, color=MUTED)

    plt.tight_layout(pad=1)
    f.savefig(os.path.join(OUT, 'job-recovery-flow.png'), dpi=150, bbox_inches='tight')
    plt.close(f)
    print('OK job-recovery-flow.png')


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    make_system_layered_overview()
    make_rate_limiting_tiers()
    make_system_architecture()
    make_queue_processing_flow()
    make_worker_execution_flow()
    make_retry_backoff_loop()
    make_job_recovery_flow()
    print('Done: 7 diagrams generated')
