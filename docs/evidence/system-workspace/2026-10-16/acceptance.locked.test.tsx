import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectEditor} from '../components/ProjectEditor';
import {readProject,updateProject,type Project} from '../features/sharing/service';
import {GET,PATCH} from '../app/api/projects/route';
describe('locked design acceptance',()=>{
 it('viewer reads but cannot mutate data',()=>{const p:Project={id:'one',title:'Original',members:{v:'viewer'}}; expect(readProject(p,'v').title).toBe('Original'); expect(()=>updateProject(p,'v','Changed')).toThrow(); expect(p.title).toBe('Original');});
 it('direct viewer API mutation returns 403 and preserves data',async()=>{const before=await GET().json();const result=await PATCH(new Request('http://fixture.invalid/api/projects',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Forbidden change'})}));expect(result.status).toBe(403);expect(await GET().json()).toEqual(before);});
 it('viewer sees disabled controls and an explicit read-only label',()=>{const html=renderToStaticMarkup(<ProjectEditor role='viewer' title='Project'/>);expect(html).toMatch(/<input[^>]+disabled/);expect(html).toMatch(/<button[^>]+disabled/);expect(html).toMatch(/읽기 전용|조회 전용/);});
 it('owner and editor continue to edit',()=>{for(const role of ['owner','editor'] as const){const p:Project={id:'one',title:'Original',members:{u:role}};expect(updateProject(p,'u','Edited').title).toBe('Edited');expect(renderToStaticMarkup(<ProjectEditor role={role} title='Project'/>)).not.toContain('disabled');}});
 it('permissions from another project cannot be reused',()=>{const a:Project={id:'a',title:'A',members:{u:'owner'}};const b:Project={id:'b',title:'B',members:{u:'viewer'}};expect(updateProject(a,'u','New A').title).toBe('New A');expect(()=>updateProject(b,'u','Bad')).toThrow();expect(b.title).toBe('B');});
});
