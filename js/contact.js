import { db, collection, addDoc, serverTimestamp } from "./firebase-init.js";

function escapeHtml(str=""){
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

document.getElementById("contactForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("contactMsg");
  msgEl.innerHTML = "";

  const name = document.getElementById("contactName").value.trim();
  const contact = document.getElementById("contactContact").value.trim();
  const type = document.getElementById("contactType").value;
  const message = document.getElementById("contactMessage").value.trim();

  if(!name || !contact || !message){
    msgEl.innerHTML = `<div class="msg-err">عبّي كل الحقول قبل الإرسال.</div>`;
    return;
  }

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";
  try{
    await addDoc(collection(db, "feedback"), {
      name, contact, type, message,
      submittedAt: serverTimestamp(),
    });
    document.getElementById("contactForm").reset();
    msgEl.innerHTML = `<div class="msg-ok">تم إرسال رسالتك، شكراً على وقتك! 🙏</div>`;
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">حدث خطأ: ${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال";
  }
});
