import { describe,it,expect,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { confirm } from '../src/commands/ui.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
describe('global-ban confirmation',()=> {
  function fixture() {
    const collector:any=new EventEmitter();collector.stop=vi.fn((reason:string)=>collector.emit('end',[],reason));
    const message={createMessageComponentCollector:()=>collector,edit:vi.fn().mockResolvedValue({})};
    const ctx:any={member:{id:'moderator'},reply:vi.fn().mockResolvedValue(message)};
    const execute=vi.fn().mockResolvedValue('Done');
    const click=(userId:string,customId:string)=>({user:{id:userId},customId,reply:vi.fn().mockResolvedValue({}),deferUpdate:vi.fn().mockResolvedValue({}),editReply:vi.fn().mockResolvedValue({})});
    return {collector,message,ctx,execute,click};
  }
  it('rejects another moderator and consumes an authorized confirmation once',async()=> {
    const f=fixture();await confirm(f.ctx,'Confirm?',f.execute);
    const stranger=f.click('stranger','key:yes');f.collector.emit('collect',stranger);await tick();
    expect(stranger.reply).toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled();
    f.collector.emit('collect',f.click('moderator','key:yes'));f.collector.emit('collect',f.click('moderator','key:yes'));await tick();
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('cancels without taking action',async()=> {
    const f=fixture();await confirm(f.ctx,'Confirm?',f.execute);f.collector.emit('collect',f.click('moderator','key:no'));await tick();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('expires with buttons removed and no punishment',async()=> {
    const f=fixture();await confirm(f.ctx,'Confirm?',f.execute);f.collector.emit('end',[],'time');await tick();
    expect(f.message.edit).toHaveBeenCalledWith(expect.objectContaining({components:[]}));expect(f.execute).not.toHaveBeenCalled();
  });
});
