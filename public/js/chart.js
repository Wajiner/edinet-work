/* ==========================================================================
   chart.js
   Plotly.js を用いた3Dバブルチャートのレンダリング
   ========================================================================== */

const ChartModule = (function () {
  let currentPoints = []; // 直近描画に使ったポイント配列（クリック等で参照）
  let currentContainerId = null; // 直近描画したコンテナID（視点切替で参照）
  let onHideRequest = null;   // 右クリックで企業の非表示が要求された時に呼ぶコールバック
  let onSelectRequest = null; // 左クリックで企業の財務情報表示が要求された時に呼ぶコールバック

  const DEFAULT_CAMERA = { eye: { x: 1.6, y: 1.6, z: 1.1 } };
  // 各面を正面から見るカメラ設定。eyeは見る方向の軸上に置き、upで画面の縦方向を指定する。
  const CAMERA_VIEWS = {
    default: DEFAULT_CAMERA,
    xy: { eye: { x: 0, y: 0, z: 2.5 }, up: { x: 0, y: 1, z: 0 } }, // Z軸方向から見る（X-Y平面）
    xz: { eye: { x: 0, y: 2.5, z: 0 }, up: { x: 0, y: 0, z: 1 } }, // Y軸方向から見る（X-Z平面）
    yz: { eye: { x: 2.5, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } }  // X軸方向から見る（Y-Z平面）
  };

  // 球体を左クリックするとその企業の財務情報パネルの表示をコールバックへ依頼し、
  // 右クリックするとその企業の非表示をコールバックへ依頼する。
  //
  // Plotly純正のイベントには依存しない。理由（Plotly本体のソースを直接
  // 確認して判明）：
  // ・plotly_click はネイティブのclickイベントではなく、gl3dの描画ループが
  //   requestAnimationFrame毎にマウスボタンの状態を「前フレームは押されていて
  //   今フレームは離されている」という一瞬の遷移としてポーリング検知する
  //   仕組みで、クリックがフレームの間に収まってしまうと検知漏れが起きうる。
  // ・contextmenuイベントも、Plotlyの3Dカメラコントローラが右ドラッグ＝
  //   パン（視点移動）操作として無条件に割り当てており、ほんの数pxの
  //   マウス移動でパン扱いになりネイティブのcontextmenuが発火しないことがある。
  // そのため、ホバー中の点だけはPlotlyのplotly_hover/unhover（毎フレーム
  // 現在位置を見るだけなので安定して動作する）で追跡し、クリック判定自体は
  // mousedown/mouseupの座標差が閾値以下かどうかで自前判定する。
  // コンテナ要素ごとに1回だけ登録する。
  function attachInteractionHandlers(containerEl) {
    if (!containerEl || containerEl._hideHandlerAttached) return;
    containerEl._hideHandlerAttached = true;
    let hoveredIndex = null;
    let rightDown = null; // { x, y, index } 右ボタンmousedown時点の座標とホバー中の点
    let leftDown = null;  // { x, y, index } 左ボタンmousedown時点の座標とホバー中の点
    let suppressNextContextMenu = false; // 直後のcontextmenuを抑制するか

    containerEl.on('plotly_hover', (evt) => {
      const pt = evt.points && evt.points[0];
      hoveredIndex = (pt && pt.curveNumber === 0) ? pt.pointNumber : null;
      // 球体の上にいる（＝右クリックが効く）ことをカーソル形状で示す
      containerEl.style.cursor = hoveredIndex === null ? '' : 'pointer';
    });
    containerEl.on('plotly_unhover', () => {
      hoveredIndex = null;
      containerEl.style.cursor = '';
    });
    // Plotlyのカメラコントローラより先にイベントを捕まえるため、windowに
    // キャプチャフェーズで登録する。
    window.addEventListener('mousedown', (e) => {
      // contextmenuが発火しないまま次の操作に移った場合にフラグが残らないよう、
      // 新しいマウス操作の開始時に必ずクリアする。
      suppressNextContextMenu = false;
      if (!containerEl.contains(e.target)) return;
      if (e.button === 0) leftDown = { x: e.clientX, y: e.clientY, index: hoveredIndex };
      if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY, index: hoveredIndex };
    }, true);
    // 左クリック（＝ドラッグでない）でその企業の財務情報パネルを開く。
    // 左ドラッグはPlotlyの視点回転操作なので、右クリックと同様に移動量で判別する。
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !leftDown) return;
      const moved = Math.hypot(e.clientX - leftDown.x, e.clientY - leftDown.y) > 6;
      const index = leftDown.index;
      leftDown = null;
      if (moved || index === null) return;
      const point = currentPoints[index];
      if (!point) return;
      if (onSelectRequest) onSelectRequest(point.company);
    }, true);
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !rightDown) return;
      const dx = e.clientX - rightDown.x;
      const dy = e.clientY - rightDown.y;
      const moved = Math.hypot(dx, dy) > 6; // これ以上動いたらパン操作とみなしクリック扱いしない
      const index = rightDown.index;
      rightDown = null;
      // contextmenuはmouseupの後に発火する。この時点で確認ダイアログを開くと
      // クリック座標の最前面がダイアログに変わり「チャート内か」の判定を
      // 外れてしまうため、対象要素によらず直後の1回を抑制対象にしておく。
      suppressNextContextMenu = true;
      if (moved || index === null) return;
      const point = currentPoints[index];
      if (!point) return;
      if (onHideRequest) onHideRequest(point.company);
    }, true);
    // ネイティブの右クリックメニューは非表示にする。
    window.addEventListener('contextmenu', (e) => {
      if (suppressNextContextMenu || containerEl.contains(e.target)) {
        suppressNextContextMenu = false;
        e.preventDefault();
      }
    }, true);
  }

  function sizeRefFromMarketCap(caps) {
    // 球体サイズをmarketcapの平方根スケールでマッピング
    const maxCap = Math.max(...caps, 1);
    return maxCap;
  }

  function buildHoverText(c, values, axes) {
    const lines = [
      `<b>${c.name}</b> (${c.code})`,
      `${c.sector} / ${c.market}`,
      `${axisLabel(axes.x)}: ${formatAxisValue(axes.x, values.x)}`,
      `${axisLabel(axes.y)}: ${formatAxisValue(axes.y, values.y)}`,
      `${axisLabel(axes.z)}: ${formatAxisValue(axes.z, values.z)}`,
      `時価総額: ${formatCompactMarketCap(values.cap)}`
    ];
    return lines.join('<br>');
  }

  function render(containerId, companies, state) {
    const { axisX, axisY, axisZ, capFyIndex, logX, logY, logZ, activeSectors } = state;

    const points = [];
    companies.forEach((c) => {
      if (activeSectors && !activeSectors.has(c.sector)) return;
      const x = computeAxisValue(c, axisX);
      const y = computeAxisValue(c, axisY);
      const z = computeAxisValue(c, axisZ);
      const cap = computeMetricValue(c, 'market_cap', capFyIndex);
      if (x === null || y === null || z === null || cap === null) return;
      if (logX && x <= 0) return;
      if (logY && y <= 0) return;
      if (logZ && z <= 0) return;
      points.push({ company: c, x, y, z, cap });
    });
    currentPoints = points;
    currentContainerId = containerId;

    const containerEl = document.getElementById(containerId);

    if (points.length === 0) {
      Plotly.purge(containerId);
      containerEl.innerHTML =
        '<div class="flex items-center justify-center h-full text-slate-400 text-sm">条件に一致する企業がありません。フィルターを見直してください。</div>';
      containerEl.dataset.emptyState = 'true';
      return points;
    }

    const caps = points.map((p) => p.cap);
    const maxCap = sizeRefFromMarketCap(caps);
    const sizes = points.map((p) => 8 + Math.sqrt(Math.max(p.cap, 1) / maxCap) * 42);

    const trace = {
      type: 'scatter3d',
      mode: 'markers',
      x: points.map((p) => p.x),
      y: points.map((p) => p.y),
      z: points.map((p) => p.z),
      text: points.map((p) => buildHoverText(p.company, p, { x: axisX, y: axisY, z: axisZ })),
      hovertemplate: '%{text}<extra></extra>',
      marker: {
        size: sizes,
        color: points.map((p) => p.company.color),
        opacity: 0.85,
        line: { color: 'rgba(255,255,255,0.6)', width: 0.5 }
      }
    };

    // O点＝X・Y・Zそれぞれの最小値が交わる点。0が表示範囲外になる指標があるため
    // 実際の0ではなく「表示中データの最小値」を基準点とし、そこから伸びる3本の
    // 軸線（X方向・Y方向・Z方向）だけを太線で描画する。
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const minZ = Math.min(...points.map((p) => p.z));
    const maxZ = Math.max(...points.map((p) => p.z));

    const originTrace = {
      type: 'scatter3d',
      mode: 'lines',
      x: [minX, maxX, null, minX, minX, null, minX, minX],
      y: [minY, minY, null, minY, maxY, null, minY, minY],
      z: [minZ, minZ, null, minZ, minZ, null, minZ, maxZ],
      line: { color: '#000000', width: 6 },
      hoverinfo: 'skip',
      showlegend: false
    };

    const layout = {
      margin: { l: 0, r: 0, t: 10, b: 0 },
      scene: {
        xaxis: {
          title: { text: axisLabel(axisX), font: { size: 11 } },
          type: logX ? 'log' : 'linear',
          gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', tickfont: { size: 9 }
        },
        yaxis: {
          title: { text: axisLabel(axisY), font: { size: 11 } },
          type: logY ? 'log' : 'linear',
          gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', tickfont: { size: 9 }
        },
        zaxis: {
          title: { text: axisLabel(axisZ), font: { size: 11 } },
          type: logZ ? 'log' : 'linear',
          gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', tickfont: { size: 9 }
        },
        camera: DEFAULT_CAMERA
      },
      showlegend: false,
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: '"Noto Sans JP", sans-serif', color: '#334155' }
    };

    // 直前が「条件に一致する企業がありません」のプレースホルダー表示だった場合、
    // innerHTMLを直接書き換えてPlotlyの内部DOM構造を壊しているため、react()では
    // なくnewPlot()で作り直す必要がある。
    if (containerEl.dataset.emptyState === 'true') {
      delete containerEl.dataset.emptyState;
      // newPlot()は既存の子要素を消さずに描画用DOMを足すため、プレースホルダーの
      // テキストがグラフに重なったまま残る。先に中身を空にしておく。
      containerEl.innerHTML = '';
      containerEl._hideHandlerAttached = false; // newPlot後は要素が作り直されるため再登録する
      Plotly.newPlot(containerId, [trace, originTrace], layout, { responsive: true, displaylogo: false, displayModeBar: false });
    } else {
      Plotly.react(containerId, [trace, originTrace], layout, { responsive: true, displaylogo: false, displayModeBar: false });
    }
    attachInteractionHandlers(containerEl);
    return points;
  }

  function getCurrentPoints() {
    return currentPoints;
  }

  // view: 'default' | 'xy' | 'xz' | 'yz'
  function setView(view) {
    if (!currentContainerId) return;
    const camera = CAMERA_VIEWS[view] || DEFAULT_CAMERA;
    Plotly.relayout(currentContainerId, { 'scene.camera': camera });
  }

  function setHideRequestHandler(fn) {
    onHideRequest = fn;
  }

  function setSelectRequestHandler(fn) {
    onSelectRequest = fn;
  }

  return { render, getCurrentPoints, setView, setHideRequestHandler, setSelectRequestHandler };
})();
