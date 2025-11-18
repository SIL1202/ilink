let btn = document.getElementsByClassName("collapse");
for (let i = 0; i < btn.length; i++) {
    btn[i].addEventListener("click", function () {
        let item = this.nextElementSibling;

        // 使用 getComputedStyle 來檢查當前元素的 display 屬性
        let display = window.getComputedStyle(item).display;

        if (display === "none") {
            item.style.display = "block";
            item.style.opacity = 1;  // 這個設置 opacity 可能還需要配合 CSS 設置過渡動畫來達到平滑效果
        } else {
            item.style.display = "none";
        }
    });
}
