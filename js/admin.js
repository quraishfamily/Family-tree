import {
  db, storage, auth,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "./firebase-init.js";

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
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

/* ---------------- قراءة الأعضاء الحاليين (لكل استخدامات اللوحة) ---------------- */
let membersFlat = [];
onSnapshot(query(collection(db, "members"), orderBy("createdAt","asc")), (snap)=>{
  membersFlat = [];
  snap.forEach(d => membersFlat.push({ id: d.id, ...d.data() }));
  renderManageList();
  renderParentSelect();
});

function memberLabel(m){
  return `${m.firstName} — ${m.fullName || ""}`;
}

function renderParentSelect(){
  const sel = document.getElementById("directParent");
  const current = sel.value;
  sel.innerHTML = `<option value="">— بدون (جذر الشجرة) —</option>`;
  membersFlat.forEach(m=>{
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = memberLabel(m);
    sel.appendChild(opt);
  });
  sel.value = current;
}

/* ---------------- طلبات الإضافة المعلّقة ---------------- */
const panelPending = document.getElementById("panel-pending");
onSnapshot(collection(db, "pendingSubmissions"), (snap)=>{
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  document.getElementById("pendingCount").textContent = items.length ? `(${items.length})` : "";

  if(items.length === 0){
    panelPending.innerHTML = `<div class="card"><p class="card-meta" style="margin:0;">لا توجد طلبات إضافة بانتظار المراجعة حالياً.</p></div>`;
    return;
  }

  panelPending.innerHTML = "";
  items.forEach(item=>{
    let relationLine;
    if(item.type === "father"){
      relationLine = `سيُضاف كأب لـ: ${escapeHtml(item.targetChildFirstName || "—")} (وسيصبح جذراً جديداً في هذا الفرع)`;
    } else if(item.type === "sibling"){
      relationLine = `سيُضاف كأخ/أخت لـ: ${escapeHtml(item.siblingOfFirstName || "—")}`;
    } else {
      relationLine = `يُضاف كابن/ابنة لـ: ${escapeHtml(item.parentFirstName || "جذر جديد")}`;
    }
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-head">
        <div style="display:flex;gap:12px;align-items:center;">
          ${item.photoURL ? `<img class="thumb" src="${item.photoURL}">` : ""}
          <div>
            <h4>${escapeHtml(item.firstName)}</h4>
            <div class="card-meta">
              الاسم الرباعي: ${escapeHtml(item.fullName || "—")}<br>
              الحالة: ${item.status === "deceased" ? "متوفى" : "على قيد الحياة"}
              ${item.spouseName ? `<br>الزوج/الزوجة: ${escapeHtml(item.spouseName)}` : ""}<br>
              ${relationLine}
            </div>
          </div>
        </div>
        <div class="card-meta">
          مُقدّم الطلب:<br>
          ${escapeHtml(item.submitterName || "")}<br>
          ${escapeHtml(item.submitterEmail || "")}<br>
          ${escapeHtml(item.submitterPhone || "")}
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-solid" data-approve="${item.id}">قبول ونشر</button>
        <button class="btn btn-danger" data-reject="${item.id}">رفض</button>
      </div>
    `;
    panelPending.appendChild(card);
  });

  panelPending.querySelectorAll("[data-approve]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.approve;
      const item = items.find(i=>i.id === id);
      btn.disabled = true; btn.textContent = "جارٍ النشر...";
      try{
        const baseFields = {
          firstName: item.firstName,
          fullName: item.fullName,
          status: item.status,
          spouseName: item.spouseName || null,
          photoURL: item.photoURL || null,
          createdAt: serverTimestamp(),
          approvedBy: auth.currentUser.email,
        };

        if(item.type === "father"){
          // تحقّق هل الشخص المستهدف صار له أب مسجّل بين وقت الطلب والآن
          const targetChild = membersFlat.find(m => m.id === item.targetChildId);
          const alreadyHasParent = targetChild && targetChild.parentId;
          if(alreadyHasParent){
            const proceed = confirm(
              `تنبيه: "${targetChild.firstName}" صار له أب مسجّل في الشجرة بالفعل.\n` +
              `اضغط "موافق" لإضافة "${item.firstName}" كجذر منفصل بدون ربطه بأحد، أو "إلغاء" لتجاهل الطلب.`
            );
            if(!proceed){ btn.disabled = false; btn.textContent = "قبول ونشر"; return; }
            await addDoc(collection(db, "members"), { ...baseFields, parentId: null });
          } else {
            const newFatherRef = await addDoc(collection(db, "members"), { ...baseFields, parentId: null });
            await updateDoc(doc(db, "members", item.targetChildId), { parentId: newFatherRef.id });
          }
        } else {
          // child أو sibling: parentId محسوب ومخزّن مسبقاً وقت الإرسال
          await addDoc(collection(db, "members"), { ...baseFields, parentId: item.parentId || null });
        }

        await deleteDoc(doc(db, "pendingSubmissions", id));
      }catch(err){
        alert("حدث خطأ: " + err.message);
        btn.disabled = false; btn.textContent = "قبول ونشر";
      }
    });
  });
  panelPending.querySelectorAll("[data-reject]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(!confirm("متأكد من رفض هذا الطلب؟ لا يمكن التراجع.")) return;
      await deleteDoc(doc(db, "pendingSubmissions", btn.dataset.reject));
    });
  });
});

/* ---------------- إدارة الشجرة (تعديل / حذف) ---------------- */
function renderManageList(){
  const wrap = document.getElementById("manageList");
  if(membersFlat.length === 0){
    wrap.innerHTML = `<div class="card"><p class="card-meta" style="margin:0;">لا يوجد أفراد في الشجرة بعد.</p></div>`;
    return;
  }
  const rows = membersFlat.map(m => `
    <tr>
      <td>${m.photoURL ? `<img class="thumb" src="${m.photoURL}">` : "—"}</td>
      <td>${escapeHtml(m.firstName)}</td>
      <td>${escapeHtml(m.fullName || "—")}</td>
      <td>${m.status === "deceased" ? "متوفى" : "حيّ"}</td>
      <td>
        <button class="btn btn-ghost" data-edit="${m.id}">تعديل</button>
        <button class="btn btn-danger" data-del="${m.id}">حذف</button>
      </td>
    </tr>
  `).join("");
  wrap.innerHTML = `<table class="table"><thead><tr>
    <th></th><th>الاسم</th><th>الرباعي</th><th>الحالة</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;

  wrap.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEdit(membersFlat.find(m=>m.id===btn.dataset.edit)));
  });
  wrap.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.del;
      const hasChildren = membersFlat.some(m => m.parentId === id);
      if(hasChildren){
        alert("لا يمكن حذف هذا الفرد لأن له أبناء في الشجرة. احذف الأبناء أولاً.");
        return;
      }
      if(!confirm("متأكد من حذف هذا الفرد نهائياً؟")) return;
      await deleteDoc(doc(db, "members", id));
    });
  });
}

function openEdit(m){
  document.getElementById("editId").value = m.id;
  document.getElementById("editFirstName").value = m.firstName || "";
  document.getElementById("editFullName").value = m.fullName || "";
  document.getElementById("editStatus").value = m.status || "alive";
  document.getElementById("editSpouse").value = m.spouseName || "";
  document.getElementById("editMsg").innerHTML = "";

  const parentSel = document.getElementById("editParent");
  parentSel.innerHTML = `<option value="">— بدون (جذر الشجرة) —</option>`;
  membersFlat
    .filter(other => other.id !== m.id) // ما تخلي الشخص يصير أب لنفسه
    .forEach(other=>{
      const opt = document.createElement("option");
      opt.value = other.id;
      opt.textContent = memberLabel(other);
      parentSel.appendChild(opt);
    });
  parentSel.value = m.parentId || "";

  document.getElementById("editOverlay").classList.remove("hidden");
}
document.querySelectorAll("[data-close]").forEach(btn=>{
  btn.addEventListener("click", ()=> document.getElementById(btn.dataset.close).classList.add("hidden"));
});

document.getElementById("editForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const id = document.getElementById("editId").value;
  const msgEl = document.getElementById("editMsg");
  try{
    await updateDoc(doc(db, "members", id), {
      firstName: document.getElementById("editFirstName").value.trim(),
      fullName: document.getElementById("editFullName").value.trim(),
      status: document.getElementById("editStatus").value,
      spouseName: document.getElementById("editSpouse").value.trim() || null,
      parentId: document.getElementById("editParent").value || null,
    });
    document.getElementById("editOverlay").classList.add("hidden");
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">${escapeHtml(err.message)}</div>`;
  }
});

/* ---------------- إضافة فرد مباشرة (بدون مراجعة) ---------------- */
document.getElementById("directAddForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("directAddMsg");
  msgEl.innerHTML = "";
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true; submitBtn.textContent = "جارٍ الإضافة...";

  try{
    const photoFile = document.getElementById("directPhoto").files[0];
    let photoURL = null;
    if(photoFile){
      const path = `member_photos/${Date.now()}_${Math.random().toString(36).slice(2)}_${photoFile.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, photoFile);
      photoURL = await getDownloadURL(storageRef);
    }
    await addDoc(collection(db, "members"), {
      parentId: document.getElementById("directParent").value || null,
      firstName: document.getElementById("directFirstName").value.trim(),
      fullName: document.getElementById("directFullName").value.trim(),
      status: document.getElementById("directStatus").value,
      spouseName: document.getElementById("directSpouse").value.trim() || null,
      photoURL,
      createdAt: serverTimestamp(),
      approvedBy: auth.currentUser.email,
    });
    msgEl.innerHTML = `<div class="msg-ok">تمت الإضافة إلى الشجرة.</div>`;
    e.target.reset();
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false; submitBtn.textContent = "إضافة إلى الشجرة";
  }
});
