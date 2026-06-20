
import React, { useState } from 'react';
import { Project, User, UserRole } from '../types';
import { Plus, Search, Tag, User as UserIcon, Calendar, Briefcase } from 'lucide-react';

interface ProjectBoardProps {
  projects: Project[];
  currentUser: User;
  onAddProject: (project: Project) => void;
}

export const ProjectBoard: React.FC<ProjectBoardProps> = ({ projects, currentUser, onAddProject }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProject, setNewProject] = useState<Partial<Project>>({
    title: '',
    description: '',
    tags: []
  });
  const [tagInput, setTagInput] = useState('');

  const canAddProject = currentUser.role === UserRole.SUPERVISOR || currentUser.role === UserRole.ADMIN;

  const filteredProjects = projects.filter(p => 
    p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleAddProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.title || !newProject.description) return;

    const project: Project = {
      id: Math.random().toString(36).substr(2, 9),
      title: newProject.title,
      description: newProject.description,
      tags: newProject.tags || [],
      status: 'OPEN',
      supervisorId: currentUser.role === UserRole.SUPERVISOR ? currentUser.linkedId || 's1' : 'admin',
      supervisorName: currentUser.name,
      createdAt: new Date().toISOString().split('T')[0]
    };

    onAddProject(project);
    setShowAddForm(false);
    setNewProject({ title: '', description: '', tags: [] });
  };

  const handleAddTag = () => {
    if (tagInput && !newProject.tags?.includes(tagInput)) {
      setNewProject({ ...newProject, tags: [...(newProject.tags || []), tagInput] });
      setTagInput('');
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div>
           <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
             <Briefcase className="text-indigo-600" />
             Kutatási Projektek
           </h2>
           <p className="text-slate-500 text-sm mt-1">
             {currentUser.role === UserRole.STUDENT 
               ? 'Böngéssz a témavezetők által kiírt kutatási lehetőségek között.' 
               : 'Kezelje a meghirdetett kutatási témákat és projekteket.'}
           </p>
        </div>
        
        {canAddProject && (
          <button 
            onClick={() => setShowAddForm(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
          >
            <Plus size={18} />
            Új Projekt Kiírása
          </button>
        )}
      </div>

      {showAddForm && (
        <div className="bg-white p-6 rounded-xl shadow-md border border-indigo-100 animate-fade-in">
          <h3 className="font-bold text-lg mb-4 text-slate-800">Új Kutatási Projekt</h3>
          <form onSubmit={handleAddProject} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Projekt Címe</label>
              <input 
                type="text" 
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={newProject.title}
                onChange={e => setNewProject({...newProject, title: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Leírás</label>
              <textarea 
                required
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={newProject.description}
                onChange={e => setNewProject({...newProject, description: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Címkék</label>
              <div className="flex gap-2 mb-2">
                 <input 
                   type="text"
                   className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none"
                   placeholder="Pl. AI, Kriptográfia"
                   value={tagInput}
                   onChange={e => setTagInput(e.target.value)}
                   onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                 />
                 <button type="button" onClick={handleAddTag} className="px-3 py-2 bg-slate-100 rounded-lg hover:bg-slate-200">Hozzáad</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {newProject.tags?.map(tag => (
                   <span key={tag} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs border border-indigo-100">{tag}</span>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
               <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Mégse</button>
               <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Közzététel</button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="Keresés projektek között..." 
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all bg-slate-50"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredProjects.map(project => (
          <div key={project.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
             <div className="flex justify-between items-start mb-2">
               <h3 className="text-xl font-bold text-slate-800">{project.title}</h3>
               <span className={`px-2 py-1 rounded text-xs font-bold ${project.status === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                 {project.status === 'OPEN' ? 'NYITOTT' : 'LEZÁRT'}
               </span>
             </div>
             
             <div className="flex items-center gap-4 text-sm text-slate-500 mb-4">
                <span className="flex items-center gap-1"><UserIcon size={14}/> {project.supervisorName}</span>
                <span className="flex items-center gap-1"><Calendar size={14}/> {project.createdAt}</span>
             </div>

             <p className="text-slate-600 mb-4 leading-relaxed">
               {project.description}
             </p>

             <div className="flex flex-wrap gap-2">
               {project.tags.map(tag => (
                 <span key={tag} className="flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-600 rounded-full text-xs border border-slate-200 font-medium">
                   <Tag size={10} /> {tag}
                 </span>
               ))}
             </div>
             
             {currentUser.role === UserRole.STUDENT && project.status === 'OPEN' && (
               <div className="mt-4 pt-4 border-t border-slate-50 flex justify-end">
                  <button className="text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline">
                    Jelentkezés érdeklődőként &rarr;
                  </button>
               </div>
             )}
          </div>
        ))}

        {filteredProjects.length === 0 && (
          <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
             Nincs találat a keresési feltételekre.
          </div>
        )}
      </div>
    </div>
  );
};
