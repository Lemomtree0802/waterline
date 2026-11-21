const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const apiKeysContent=()=>`<div class="modal-body api-key-manager">
  <p class="muted">用 API Key 让程序以你的玩家身份挑战，成绩与网页共用。</p>
  <form class="api-key-create"><label for="api-key-name">密钥名称</label><div class="api-key-create-row"><input id="api-key-name" name="name" maxlength="50" required placeholder="例如：模型测试" autocomplete="off"><button class="button primary" type="submit">创建密钥</button></div></form>
  <div class="api-key-secret" hidden><label for="new-api-key">请复制保存，完整密钥只显示这一次</label><input id="new-api-key" readonly autocomplete="off" spellcheck="false"><button class="text-button" type="button" data-key-copy>复制密钥</button></div>
  <p class="form-error" role="alert" data-key-error></p><div class="api-key-list" aria-live="polite">正在读取…</div>
  <p class="api-key-docs"><a href="/api/ai/v1/docs" target="_blank" rel="noopener">接口文档</a></p>
</div>`;

export function mountApiKeys(root,service,{notify=()=>{}}={}) {
  let alive=true,loadId=0;
  const form=root.querySelector('form'),error=root.querySelector('[data-key-error]'),list=root.querySelector('.api-key-list'),secret=root.querySelector('#new-api-key');
  const account=service.getProfile()?.id;
  const active=()=>alive&&service.getProfile()?.id===account;
  const date=value=>value?new Date(value).toLocaleDateString():'尚未使用';
  const load=async()=>{
    const id=++loadId;
    const {keys}=await service.getApiKeys();
    if(!active()||id!==loadId)return;
    list.innerHTML=keys.length?keys.map(key=>`<div class="api-key-item"><div><strong>${escape(key.name)}</strong><span class="api-key-suffix">•••• ${escape(key.suffix)}</span><p>${key.revoked_at?'已撤销':`创建于 ${escape(date(key.created_at))} · 最近使用：${escape(date(key.last_used_at))}`}</p></div>${key.revoked_at?'':`<button class="text-button" type="button" data-key-revoke="${escape(key.id)}">撤销</button>`}</div>`).join(''):'<p class="muted">还没有 API Key</p>';
  };
  const submit=async event=>{
    event.preventDefault();const button=form.querySelector('button');button.disabled=true;error.textContent='';
    try{
      const name=form.elements.name.value.trim();if(!name)throw Error('请填写密钥名称');
      const result=await service.createApiKey(name);
      if(!active())return;
      secret.value=result.key;root.querySelector('.api-key-secret').hidden=false;form.reset();secret.focus();secret.select();
      await load();
    }catch(e){if(active())error.textContent=e.message;}
    finally{if(active())button.disabled=false;}
  };
  const click=async event=>{
    const revoke=event.target.closest('[data-key-revoke]'),copy=event.target.closest('[data-key-copy]');
    if(!revoke&&!copy)return;
    error.textContent='';
    try{
      if(copy){await navigator.clipboard.writeText(secret.value);if(active())notify('已复制密钥');}
      else{revoke.disabled=true;await service.revokeApiKey(revoke.dataset.keyRevoke);if(!active())return;secret.value='';root.querySelector('.api-key-secret').hidden=true;await load();}
    }catch(e){if(active()){error.textContent=e.message;if(revoke)revoke.disabled=false;}}
  };
  form.addEventListener('submit',submit);root.addEventListener('click',click);
  void load().catch(e=>{if(active()){list.textContent='';error.textContent=e.message;}});
  return {destroy(){alive=false;loadId++;secret.value='';root.replaceChildren();form.removeEventListener('submit',submit);root.removeEventListener('click',click);}};
}
