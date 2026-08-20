const PptxGenJS = require('pptxgenjs');
const path = require('path');
const docsFolder = path.join(process.env.USERPROFILE || '', 'Documents');
const filePath = path.join(docsFolder, 'test_ppt.pptx');
const pptx = new PptxGenJS();
let slide = pptx.addSlide();
slide.addText('Hello World!', { x:1.5, y:1.5, fontSize:18, color:'363636' });
pptx.writeFile({ fileName: filePath }).then(fileName => {
    console.log(`created file: ${fileName}`);
}).catch(err => {
    console.error(err);
});
