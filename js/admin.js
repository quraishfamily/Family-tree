import {
  db, storage, auth,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "./firebase-init.js";

const FAMILIES = {
  quraish:  "آل قريش",
  abbas:    "آل عباس",
  abdrabbo: "آل عبدربه",
  alsaleh:  "الصالح",
};

function familyLabel(familyId){
  return FAMILIES[familyId] || "بدون عائلة محددة";
}

function escapeHtml(str=""){
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------------- تسجيل الدخول ---------------- */
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");

document.getElementById("loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const msgEl = document.getElementById("loginMsg");
  msgEl.innerHTML = "";
  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">فشل الدخول: ${escapeHtml(err.message)}</div>`;
  }
});

document.getElementById("logoutBtn").addEventListener("click", ()=> signOut(auth));

onAuthStateChanged(auth, (user)=>{
  if(user){
    loginView.style.display = "none";
    dashboardView.style.display = "block";
    document.getElementById("whoAmI").textContent = `مسجّل الدخول: ${user.email}`;
  } else {
    loginView.style.display = "block";
    dashboardView.style.display = "none";
  }
});

/* ---------------- تقييد حقل "الاسم الأول" بكلمة واحدة فقط ---------------- */
function restrictToSingleWord(input){
  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\s+/g, "");
  });
}
restrictToSingleWord(document.getElementById("directFirstName"));
restrictToSingleWord(document.getElementById("editFirstName"));
document.querySelectorAll(".tab-btn").forEach(btn=>{
