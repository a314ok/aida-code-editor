import { reactive } from 'vue';

export const tabDrag = reactive({
  active: false,
  fromWindowId: '',
  tabPath: '',
  droppedInWindow: false,
});
