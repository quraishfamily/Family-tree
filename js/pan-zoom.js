// وحدة مشتركة للتقريب/التبعيد وتحريك الشجرة — تُستخدم في صفحة الزوار ولوحة الأدمن
export function initPanZoom(viewport, content){
  let scale = 1;
  const minScale = 0.15;
  const maxScale = 3;
  let originX = 0;
  let originY = 0;
  let isPanning = false;
  let startX = 0, startY = 0, startOriginX = 0, startOriginY = 0;
  let touchStartDist = null;
  let touchStartScale = 1;
  let lastTouchX = 0, lastTouchY = 0;

  function apply(){
    content.style.transform = `translate(${originX}px, ${originY}px) scale(${scale})`;
  }

  function zoomBy(factor, clientX, clientY){
    const rect = viewport.getBoundingClientRect();
    const cx = (clientX !== undefined) ? clientX - rect.left : rect.width / 2;
    const cy = (clientY !== undefined) ? clientY - rect.top : rect.height / 2;
    const newScale = Math.min(maxScale, Math.max(minScale, scale * factor));
    originX = cx - ((cx - originX) * (newScale / scale));
    originY = cy - ((cy - originY) * (newScale / scale));
    scale = newScale;
    apply();
  }

  function fitToView(){
    scale = 1; originX = 0; originY = 0;
    apply();
    requestAnimationFrame(()=>{
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const cw = content.scrollWidth;
      const ch = content.scrollHeight;
      if(!cw || !ch || !vw || !vh) return;
      const s = Math.min(vw / cw, vh / ch, 1) * 0.94;
      scale = Math.max(minScale, s);
      originX = (vw - cw * scale) / 2;
      originY = 24;
      apply();
    });
  }

  viewport.addEventListener("wheel", (e)=>{
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomBy(factor, e.clientX, e.clientY);
  }, { passive: false });

  viewport.addEventListener("mousedown", (e)=>{
    if(e.target.closest(".node") || e.target.closest(".zoom-controls")) return;
    isPanning = true;
    startX = e.clientX; startY = e.clientY;
    startOriginX = originX; startOriginY = originY;
    viewport.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e)=>{
    if(!isPanning) return;
    originX = startOriginX + (e.clientX - startX);
    originY = startOriginY + (e.clientY - startY);
    apply();
  });
  window.addEventListener("mouseup", ()=>{
    isPanning = false;
    viewport.style.cursor = "grab";
  });

  function touchDist(touches){
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  viewport.addEventListener("touchstart", (e)=>{
    if(e.target.closest(".zoom-controls")) return;
    if(e.touches.length === 1){
      if(e.target.closest(".node")) return;
      isPanning = true;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    } else if(e.touches.length === 2){
      isPanning = false;
      touchStartDist = touchDist(e.touches);
      touchStartScale = scale;
    }
  }, { passive: true });

  viewport.addEventListener("touchmove", (e)=>{
    if(e.touches.length === 1 && isPanning){
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      originX += dx; originY += dy;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      apply();
    } else if(e.touches.length === 2 && touchStartDist){
      const dist = touchDist(e.touches);
      scale = Math.min(maxScale, Math.max(minScale, touchStartScale * (dist / touchStartDist)));
      apply();
    }
  }, { passive: true });

  viewport.addEventListener("touchend", ()=>{
    isPanning = false;
    touchStartDist = null;
  });

  viewport.style.cursor = "grab";

  return {
    zoomIn: ()=> zoomBy(1.2),
    zoomOut: ()=> zoomBy(0.8),
    reset: fitToView,
    fit: fitToView,
  };
}
