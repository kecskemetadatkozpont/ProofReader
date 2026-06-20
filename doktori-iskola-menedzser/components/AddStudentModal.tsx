
import React, { useState, useEffect } from 'react';
import { Student, StudentStatus, User, UserRole } from '../types';
import { X, Wand2, Lock } from 'lucide-react';

interface AddStudentModalProps {
  onClose: () => void;
  onSave: (student: Student) => void;
  currentUser: User;
}

export const AddStudentModal: React.FC<AddStudentModalProps> = ({ onClose, onSave, currentUser }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    supervisor: '',
    topic: '',
    enrollmentYear: new Date().getFullYear(),
  });
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  useEffect(() => {
    // Auto-fill supervisor if logged in as supervisor
    if (currentUser.role === UserRole.SUPERVISOR) {
      setFormData(prev => ({
        ...prev,
        supervisor: currentUser.name
      }));
    }
  }, [currentUser]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newStudent: Student = {
      id: Math.random().toString(36).substr(2, 9),
      ...formData,
      supervisorId: currentUser.role === UserRole.SUPERVISOR ? currentUser.linkedId : undefined,
      status: StudentStatus.ACTIVE,
      totalCredits: 0,
      requiredCredits: 240,
      avatarUrl: `https://picsum.photos/seed/${formData.name}/200/200`,
      milestones: [] // Empty initially
    };
    onSave(newStudent);
  };

  const handleAutoFillTopic = async () => {
    if (!formData.topic) return;
    setLoadingSuggestion(true);
    setTimeout(() => setLoadingSuggestion(false), 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800">Új Hallgató Regisztrálása</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Név</label>
            <input 
              required
              type="text" 
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50 text-slate-900 placeholder-slate-400"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input 
              required
              type="email" 
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50 text-slate-900 placeholder-slate-400"
              value={formData.email}
              onChange={e => setFormData({...formData, email: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Témavezető</label>
            <div className="relative">
              <input 
                required
                type="text" 
                disabled={currentUser.role === UserRole.SUPERVISOR}
                className={`w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none bg-slate-50 text-slate-900 
                  ${currentUser.role === UserRole.SUPERVISOR ? 'opacity-75 cursor-not-allowed pr-10' : 'focus:ring-2 focus:ring-blue-500'}`}
                value={formData.supervisor}
                onChange={e => setFormData({...formData, supervisor: e.target.value})}
              />
              {currentUser.role === UserRole.SUPERVISOR && (
                <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Kutatási Téma
              <button 
                type="button" 
                onClick={handleAutoFillTopic}
                className="ml-2 text-xs text-blue-600 hover:text-blue-800"
                title="AI segítség kérése"
              >
                {loadingSuggestion ? <span className="animate-pulse">Elemzés...</span> : <span className="flex items-center gap-1"><Wand2 size={12}/> AI Javaslat</span>}
              </button>
            </label>
            <textarea 
              required
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50 text-slate-900 placeholder-slate-400"
              value={formData.topic}
              onChange={e => setFormData({...formData, topic: e.target.value})}
            />
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Mégse
            </button>
            <button 
              type="submit" 
              className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
            >
              Mentés
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
