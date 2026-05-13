(() => {
  const PASSWORD  = '1204';
  const RELOCK_MS = 60_000;

  const lockTargets = document.querySelectorAll('.lock-target');
  if (!lockTargets.length) return;

  // 各セクションごとにロック機能を付与
  lockTargets.forEach((lockTarget) => {

    // オーバーレイを重ねるために position を調整
    const currentPos = getComputedStyle(lockTarget).position;
    if (currentPos === 'static' || !currentPos) {
      lockTarget.style.position = 'relative';
    }

    // ==== オーバーレイ（セクション全体を薄暗く） ====
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',                         // そのセクションの内部全面
      background: 'rgba(0,0,0,0.7)',
      zIndex: '9999',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: '0',
      pointerEvents: 'none',
      borderRadius: '0.5rem',
      transition: 'opacity 0.2s ease',
    });

    // ==== 中央に置くのは入力欄だけ ====
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'Locked🔒';
    Object.assign(input.style, {
      width: '10rem',
      padding: '0.2rem 0.2rem',
      fontSize: '2rem',
      border: '1px solid #aaa',
      borderRadius: '0.2rem',
      background: 'rgba(255,255,255,1)',
      outline: 'none',
      textAlign: 'center',
    });

    overlay.appendChild(input);
    lockTarget.appendChild(overlay);

    let relockTimer = null;

    // ===== このセクション専用のロック制御 =====
    function setLocked(locked) {
      if (locked) {
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
        lockTarget.classList.add('is-locked');

        if (relockTimer) clearTimeout(relockTimer);
        setTimeout(() => input.focus(), 0);
      } else {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        lockTarget.classList.remove('is-locked');

        if (relockTimer) clearTimeout(relockTimer);
        relockTimer = setTimeout(() => setLocked(true), RELOCK_MS);
      }
    }

    // 初期ロック
    setLocked(true);

    // ==== Enterで解除 ====
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;

      const code = input.value.trim();

      if (code !== PASSWORD) {
        input.value = '';
        input.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(4px)' },
            { transform: 'translateX(0)' }
          ],
          { duration: 150 }
        );
        return;
      }

      input.value = '';
      setLocked(false);
    });
  });
})();