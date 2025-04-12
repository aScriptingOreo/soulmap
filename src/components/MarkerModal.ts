import type { Location } from '../types';

export class MarkerModal {
  private modal: HTMLElement;
  private form: HTMLFormElement;

  constructor() {
    this.createModal();
  }

  private createModal(): void {
    this.modal = document.createElement('div');
    this.modal.className = 'marker-modal';
    this.modal.innerHTML = `
      <div class="marker-modal-content">
        <h2>Add Custom Marker</h2>
        <form id="marker-form">
          <div class="form-group">
            <label for="name">Name *</label>
            <input type="text" id="name" name="name" required>
          </div>
          <div class="form-group">
            <label for="coordinates">Coordinates *</label>
            <input type="text" id="coordinates" name="coordinates" required readonly>
          </div>
          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" name="description"></textarea>
          </div>
          <div class="form-group">
            <label for="icon">Icon (Default: fa-solid fa-thumbtack)</label>
            <input type="text" id="icon" name="icon" value="fa-solid fa-thumbtack">
          </div>
          <div class="form-group">
            <label for="iconSize">Icon Size</label>
            <input type="number" id="iconSize" name="iconSize" step="0.25" min="0.25" value="1">
          </div>
          <div class="form-group">
            <label for="iconColor">Icon Color</label>
            <input type="color" id="iconColor" name="iconColor" value="#FFFFFF">
          </div>
          <div class="form-group">
            <label for="mediaUrl">Image URL (Optional)</label>
            <input type="url" id="mediaUrl" name="mediaUrl">
          </div>
          <div class="form-actions">
            <button type="submit">Save</button>
            <button type="button" class="cancel">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(this.modal);
    this.form = this.modal.querySelector('form') as HTMLFormElement;
    
    this.form.querySelector('.cancel')?.addEventListener('click', () => this.hide());
    this.form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (this.onSubmit) {
            const formData = new FormData(this.form);
            const markerData: Partial<Location> = {
                name: formData.get('name') as string,
                coordinates: JSON.parse(formData.get('coordinates') as string),
                description: formData.get('description') as string || '',
                icon: formData.get('icon') as string || 'fa-solid fa-thumbtack',
                iconSize: Number(formData.get('iconSize')) || 1,
                iconColor: formData.get('iconColor') as string || '#FFFFFF',
                mediaUrl: formData.get('mediaUrl') as string || undefined
            };
            this.onSubmit(markerData as Location); // Cast as Location since we know required fields are present
        }
        this.hide();
    });
  }

  public show(coordinates: [number, number]): void {
    this.form.reset();
    (this.form.querySelector('#coordinates') as HTMLInputElement).value = 
      JSON.stringify(coordinates);
    this.modal.style.display = 'flex';
  }

  public hide(): void {
    this.modal.style.display = 'none';
  }

  public onSubmit?: (data: Partial<Location>) => void;
}